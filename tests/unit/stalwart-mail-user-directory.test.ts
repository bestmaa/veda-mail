import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({
  assertSafeProviderOrigin: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import { MailUserAdministrationError } from "@/domain/admin/mail-user";
import { createStalwartMailUserAdministrator } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-user-administrator";
import {
  commonReadHandler,
  DOMAIN,
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

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart mailbox directory", () => {
  it("lists only safe users from the configured domain", async () => {
    const group = { "@type": "Group", id: "group-1", name: "group" };
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/query") {
        return { payload: queryResult([USER.id, group.id], 3) };
      }
      if (call.method === "x:Account/get") {
        return { payload: getResult([USER, group]) };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    const page = await createAdministrator().listUsers({
      domain: "EXAMPLE.com.",
      limit: 2,
      query: "ali",
    });

    expect(page).toEqual({
      items: [
        {
          aliases: ["alias@example.com"],
          createdAt: USER.createdAt,
          displayName: "Alice",
          email: USER.emailAddress,
          id: USER.id,
          maxDiskQuota: 1_000_000,
          usedDiskQuota: 50_000,
        },
      ],
      nextCursor: group.id,
    });
    expect(JSON.stringify(page)).not.toContain("provider-private-secret");
    const query = calls.find(({ method }) => method === "x:Account/query");
    expect(query?.arguments).toMatchObject({
      filter: {
        conditions: [{ domainId: DOMAIN.id }, { text: "ali" }],
        operator: "AND",
      },
      limit: 2,
    });
    const get = calls.find(({ method }) => method === "x:Account/get");
    expect(get?.arguments).not.toHaveProperty("credentials");
    expect(JSON.stringify(get?.arguments)).not.toMatch(
      /credentials|permissions|roles/u,
    );
  });

  it("uses an opaque account anchor for the next page", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/query") {
        return { payload: queryResult([], 0) };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await createAdministrator().listUsers({
      cursor: "previous-user",
      domain: "example.com",
      limit: 20,
    });

    const query = calls.find(({ method }) => method === "x:Account/query");
    expect(query?.arguments).toMatchObject({
      anchor: "previous-user",
      anchorOffset: 1,
    });
  });

  it("never returns a user from a different provider domain", async () => {
    installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Account/get") {
        return {
          payload: getResult([
            { ...USER, domainId: "other-domain", id: "foreign-user" },
          ]),
        };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().getUser({
        domain: "example.com",
        userId: "foreign-user",
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects domains outside the installation allowlist before transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const failure = await failureFrom(
      createAdministrator().listUsers({
        domain: "private.example",
        limit: 20,
      }),
    );

    expect(failure).toBeInstanceOf(MailUserAdministrationError);
    expect(failure).toMatchObject({ code: "invalid-input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const failureFrom = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
    return null;
  } catch (error) {
    return error;
  }
};
