import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({ assertSafeProviderOrigin: vi.fn() }));
vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import { createStalwartMailUserAdministrator } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-administrator";
import {
  commonReadHandler,
  getResult,
  installManagementFetch,
  USER,
} from "./stalwart-management-test-support";

const administrator = () => createStalwartMailUserAdministrator({
  allowedDomains: ["example.com"],
  apiKey: "management-secret",
  baseUrl: "https://mail.example.com",
  expectedOrigin: "https://mail.example.com",
});
const input = { domain: "example.com", userId: USER.id };

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("Stalwart mailbox-user lifecycle", () => {
  it("disables access by replacing credentials without deleting mailbox data", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/get") return { payload: getResult([USER]) };
      if (call.method === "x:Account/set") {
        return { payload: { updated: { [USER.id]: null } } };
      }
      throw new Error(`Unexpected ${call.method}`);
    });

    await expect(administrator().mutateUser({ ...input, expectedEmail: USER.emailAddress, operation: "disable" }))
      .resolves.toMatchObject({ outcome: "disabled", userId: USER.id });
    const mutation = calls.find((call) => call.method === "x:Account/set");
    expect(mutation?.arguments).toEqual({
      update: { [USER.id]: { credentials: {} } },
    });
    expect(mutation?.arguments).not.toHaveProperty("destroy");
  });

  it("permanently deletes only the exact resolved account id", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/get") return { payload: getResult([USER]) };
      if (call.method === "x:Account/set") {
        return { payload: { destroyed: [USER.id] } };
      }
      throw new Error(`Unexpected ${call.method}`);
    });

    await expect(administrator().mutateUser({ ...input, expectedEmail: USER.emailAddress, operation: "delete" }))
      .resolves.toMatchObject({ outcome: "deleted", email: USER.emailAddress });
    expect(calls.find((call) => call.method === "x:Account/set")?.arguments)
      .toEqual({ destroy: [USER.id] });
  });

  it("maps narrow-permission denial and never claims mutation success", async () => {
    installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/get") return { payload: getResult([USER]) };
      if (call.method === "x:Account/set") {
        return { payload: { notDestroyed: { [USER.id]: { type: "forbidden" } } } };
      }
      throw new Error(`Unexpected ${call.method}`);
    });

    await expect(administrator().mutateUser({ ...input, expectedEmail: USER.emailAddress, operation: "delete" }))
      .rejects.toMatchObject({ code: "provider-auth" });
  });

  it("rejects an email/account mismatch before provider mutation", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/get") return { payload: getResult([USER]) };
      throw new Error(`Unexpected ${call.method}`);
    });
    await expect(administrator().mutateUser({
      ...input, expectedEmail: "other@example.com", operation: "delete",
    })).rejects.toMatchObject({ code: "invalid-input" });
    expect(calls.some((call) => call.method === "x:Account/set")).toBe(false);
  });
});
