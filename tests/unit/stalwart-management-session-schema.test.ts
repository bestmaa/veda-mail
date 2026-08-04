import { describe, expect, it } from "vitest";

import { stalwartManagementSessionSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import { STALWART_JMAP } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const accountScopedSession = {
  accounts: {
    administrator: {
      accountCapabilities: { [STALWART_JMAP]: {} },
    },
  },
  apiUrl: "https://mail.example.com/jmap/",
  capabilities: {},
  primaryAccounts: { [STALWART_JMAP]: "administrator" },
};

describe("Stalwart management session schema", () => {
  it("accepts the account-scoped capability advertised by Stalwart", () => {
    expect(stalwartManagementSessionSchema.safeParse(accountScopedSession).success)
      .toBe(true);
  });

  it("rejects a primary management account missing from the account map", () => {
    expect(
      stalwartManagementSessionSchema.safeParse({
        ...accountScopedSession,
        accounts: {},
      }).success,
    ).toBe(false);
  });

  it("rejects an account without the management capability", () => {
    expect(
      stalwartManagementSessionSchema.safeParse({
        ...accountScopedSession,
        accounts: {
          administrator: { accountCapabilities: {} },
        },
      }).success,
    ).toBe(false);
  });
});
