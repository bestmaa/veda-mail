import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({
  assertSafeProviderOrigin: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import { createStalwartMailUserAdministrator } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-administrator";
import {
  commonReadHandler,
  getResult,
  installManagementFetch,
  queryResult,
  USER,
} from "./stalwart-management-test-support";

const createAdministrator = () =>
  createStalwartMailUserAdministrator({
    allowedDomains: ["example.com"],
    apiKey: "management-secret",
    baseUrl: "https://mail.example.com",
    expectedOrigin: "https://mail.example.com",
  });
const input = {
  displayName: "Alice",
  email: "alice@example.com",
  password: "NeverReturnThisPassword!42",
};
const authentication = getResult([{ directoryId: null, id: "singleton" }]);

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Stalwart mailbox password policy boundaries", () => {
  it("maps safe Stalwart policy rejection to invalid input", async () => {
    installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Authentication/get") {
        return { payload: authentication };
      }
      if (call.method === "x:Account/query") {
        return { payload: queryResult([]) };
      }
      if (call.method === "x:Account/set") {
        return {
          payload: { notCreated: { user: { type: "invalidProperties" } } },
        };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().createUser(input),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("accepts 1000 password characters but rejects 1001", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Authentication/get") {
        return { payload: authentication };
      }
      if (call.method === "x:Account/query") {
        return { payload: queryResult([]) };
      }
      if (call.method === "x:Account/set") {
        return { payload: { created: { user: { id: USER.id } } } };
      }
      if (call.method === "x:Action/set") {
        return { payload: { created: { cache: { id: "action-1" } } } };
      }
      if (call.method === "x:Account/get") {
        return { payload: getResult([USER]) };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });
    const administrator = createAdministrator();

    await expect(
      administrator.createUser({ ...input, password: "x".repeat(1_000) }),
    ).resolves.toMatchObject({ outcome: "created" });
    const callCount = calls.length;
    await expect(
      administrator.createUser({ ...input, password: "x".repeat(1_001) }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(calls).toHaveLength(callCount);
  });
});
