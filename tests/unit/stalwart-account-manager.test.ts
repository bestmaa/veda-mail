import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import { StalwartAccountManager } from "@/infrastructure/providers/stalwart-jmap/stalwart-account-manager";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_SUBMISSION,
  STALWART_JMAP,
  type JmapMethodCall,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const reader = {
  getAccount: async () => ({
    email: "member@example.com",
    id: id.account("account"),
    name: "Member",
    providerId: id.provider("stalwart-jmap"),
  }),
  getAccountId: async () => "account",
} as unknown as StalwartMailReader;

const createClient = (rejectUpdate = false) => {
  const requests: {
    readonly calls: readonly JmapMethodCall[];
    readonly using: readonly string[];
  }[] = [];
  const client = {
    request: async (
      calls: readonly JmapMethodCall[],
      using: readonly string[],
    ) => {
      requests.push({ calls, using });
      return { methodResponses: [], sessionState: "state" };
    },
    result: (
      _response: unknown,
      _callId: string,
      expectedMethod: string,
    ) => {
      if (expectedMethod === "Identity/get") {
        return {
          list: [
            {
              email: "member@example.com",
              id: "identity",
              name: "Old name",
            },
          ],
        };
      }
      return rejectUpdate ? { notUpdated: { singleton: {} } } : {};
    },
  } as unknown as StalwartJmapClient;
  return { client, requests };
};

describe("Stalwart account manager", () => {
  it("updates the matching sender identity display name", async () => {
    const { client, requests } = createClient();
    const manager = new StalwartAccountManager(client, reader);

    await expect(
      manager.updateProfile({ displayName: "New Name" }),
    ).resolves.toEqual({
      displayName: "New Name",
      email: "member@example.com",
    });
    expect(requests[1]).toEqual({
      calls: [
        [
          "Identity/set",
          {
            accountId: "account",
            update: { identity: { name: "New Name" } },
          },
          "profile",
        ],
      ],
      using: [JMAP_SUBMISSION],
    });
  });

  it("changes the password with current-secret and optional OTP proof", async () => {
    const { client, requests } = createClient();
    const manager = new StalwartAccountManager(client, reader);

    await manager.changePassword({
      currentPassword: "old-password",
      newPassword: "new-password",
      otpCode: "123456",
    });

    expect(requests[0]).toEqual({
      calls: [
        [
          "x:AccountPassword/set",
          {
            update: {
              singleton: {
                currentSecret: "old-password",
                otpAuth: { otpCode: "123456" },
                secret: "new-password",
              },
            },
          },
          "password",
        ],
      ],
      using: [STALWART_JMAP],
    });
  });

  it("rejects a password update refused by Stalwart", async () => {
    const { client } = createClient(true);
    await expect(
      new StalwartAccountManager(client, reader).changePassword({
        currentPassword: "wrong-password",
        newPassword: "new-password",
      }),
    ).rejects.toThrow("rejected");
  });

  it("reads whether an authenticator credential is configured", async () => {
    const client = {
      request: async () => ({ methodResponses: [], sessionState: "state" }),
      result: () => ({
        list: [{ otpAuth: { otpUrl: "********" } }],
      }),
    } as unknown as StalwartJmapClient;

    await expect(
      new StalwartAccountManager(client, reader).getTwoFactorEnabled(),
    ).resolves.toBe(true);
  });

  it("sends password and OTP proof when disabling two-factor auth", async () => {
    const { client, requests } = createClient();
    const manager = new StalwartAccountManager(client, reader);

    await manager.updateTwoFactor({
      currentPassword: "password",
      otpCode: "123456",
      otpUrl: null,
    });

    expect(requests[0]?.calls[0]).toEqual([
      "x:AccountPassword/set",
      {
        update: {
          singleton: {
            currentSecret: "password",
            otpAuth: { otpCode: "123456", otpUrl: null },
          },
        },
      },
      "two-factor",
    ]);
  });
});
