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
  DOMAIN,
  getResult,
  installManagementFetch,
  queryResult,
  type RecordedManagementCall,
  USER,
} from "./stalwart-management-test-support";

const createAdministrator = () =>
  createStalwartMailUserAdministrator({
    allowedDomains: ["example.com"],
    apiKey: "management-secret",
    baseUrl: "https://mail.example.com",
    expectedOrigin: "https://mail.example.com",
  });
const createInput = {
  displayName: "Alice",
  email: "alice@example.com",
  password: "NeverReturnThisPassword!42",
};
const SAFE_USER = {
  aliases: ["alias@example.com"],
  createdAt: USER.createdAt,
  displayName: "Alice",
  email: USER.emailAddress,
  id: USER.id,
  locale: USER.locale,
  maxDiskQuota: 1_000_000,
  timeZone: USER.timeZone,
  usedDiskQuota: USER.usedDiskQuota,
};

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart mailbox provisioning", () => {
  it("creates a least-privilege user and never returns its secret", async () => {
    const { calls } = installManagementFetch(successHandler());

    const result = await createAdministrator().createUser(createInput);

    expect(result).toMatchObject({ outcome: "created", user: SAFE_USER });
    expect(JSON.stringify(result)).not.toContain(createInput.password);
    const create = calls.find(({ method }) => method === "x:Account/set");
    const account = createdAccount(create);
    expect(account).toMatchObject({
      "@type": "User",
      aliases: {},
      credentials: {
        "0": { "@type": "Password", secret: createInput.password },
      },
      domainId: DOMAIN.id,
      encryptionAtRest: { "@type": "Disabled" },
      memberGroupIds: {},
      name: "alice",
      permissions: { "@type": "Inherit" },
      quotas: {},
      roles: { "@type": "User" },
    });
    expect(calls.some(({ method }) => method === "x:Action/set")).toBe(true);
  });

  it("rejects creation backed by an external directory", async () => {
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Authentication/get") {
        return { payload: authenticationResult("ldap-directory") };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().createUser(createInput),
    ).rejects.toMatchObject({ code: "external-directory" });
    expect(calls.some(({ method }) => method === "x:Account/set")).toBe(false);
  });

  it.each(["transport timeout", "malformed result", "serverPartialFail"])(
    "never claims success after an ambiguous %s",
    async (failureMode) => {
    let accountQueryCount = 0;
    const { calls } = installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Authentication/get") {
        return { payload: authenticationResult(null) };
      }
      if (call.method === "x:Account/query") {
        accountQueryCount += 1;
        return {
          payload: queryResult(accountQueryCount === 1 ? [] : [USER.id]),
        };
      }
      if (call.method === "x:Account/get") {
        return { payload: getResult([USER]) };
      }
      if (call.method === "x:Account/set") {
        if (failureMode === "transport timeout") {
          throw new DOMException("private timeout", "TimeoutError");
        }
        if (failureMode === "serverPartialFail") {
          return { method: "error", payload: { type: "serverPartialFail" } };
        }
        return { payload: { created: { user: {} } } };
      }
      if (call.method === "x:Action/set") return cacheSuccess();
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().createUser(createInput),
    ).rejects.toMatchObject({ code: "create-outcome-unknown" });
    expect(calls.filter(({ method }) => method === "x:Account/query")).toHaveLength(2);
    expect(calls.some(({ method }) => method === "x:Action/set")).toBe(false);
    },
  );

  it("reports a safe warning when cache invalidation fails", async () => {
    const handler = successHandler(true);
    installManagementFetch(handler);

    await expect(createAdministrator().createUser(createInput)).resolves.toMatchObject({
      outcome: "created",
      warning: "cache-invalidation-failed",
    });
  });

  it("maps a raced notCreated result to duplicate", async () => {
    let accountQueryCount = 0;
    installManagementFetch((call) => {
      const common = commonReadHandler(call);
      if (common) return common;
      if (call.method === "x:Authentication/get") {
        return { payload: authenticationResult(null) };
      }
      if (call.method === "x:Account/query") {
        accountQueryCount += 1;
        return {
          payload: queryResult(accountQueryCount === 1 ? [] : [USER.id]),
        };
      }
      if (call.method === "x:Account/get") {
        return { payload: getResult([USER]) };
      }
      if (call.method === "x:Account/set") {
        return {
          payload: { notCreated: { user: { type: "invalidProperties" } } },
        };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().createUser(createInput),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("reports disabled domains without requesting authentication", async () => {
    const { calls } = installManagementFetch((call) => {
      if (call.method === "x:Domain/query") {
        return { payload: queryResult([DOMAIN.id]) };
      }
      if (call.method === "x:Domain/get") {
        return { payload: getResult([{ ...DOMAIN, isEnabled: false }]) };
      }
      throw new Error(`Unexpected method ${call.method}`);
    });

    await expect(
      createAdministrator().getCreationAvailability("example.com"),
    ).resolves.toEqual({ available: false, reason: "domain-disabled" });
    expect(calls.some(({ method }) => method === "x:Authentication/get")).toBe(
      false,
    );
  });

});

const authenticationResult = (directoryId: string | null) =>
  getResult([{ directoryId, id: "singleton" }]);

const cacheSuccess = () => ({
  payload: { created: { cache: { id: "action-1" } } },
});

const successHandler = (failCache = false) =>
  (call: RecordedManagementCall) => {
    const common = commonReadHandler(call);
    if (common) return common;
    if (call.method === "x:Authentication/get") {
      return { payload: authenticationResult(null) };
    }
    if (call.method === "x:Account/query") {
      return { payload: queryResult([]) };
    }
    if (call.method === "x:Account/set") {
      return { payload: { created: { user: { id: USER.id } } } };
    }
    if (call.method === "x:Action/set") {
      if (failCache) throw new Error("cache unavailable");
      return cacheSuccess();
    }
    if (call.method === "x:Account/get") {
      return { payload: getResult([USER]) };
    }
    throw new Error(`Unexpected method ${call.method}`);
  };

const createdAccount = (
  call: RecordedManagementCall | undefined,
): Readonly<Record<string, unknown>> => {
  const create = call?.arguments["create"] as
    | Readonly<Record<string, Readonly<Record<string, unknown>>>>
    | undefined;
  return create?.["user"] ?? {};
};
