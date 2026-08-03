import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { StalwartMailGateway } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.gateway";
import { StalwartProviderModule } from "@/infrastructure/providers/stalwart-jmap/stalwart-provider.module";
import {
  JMAP_CORE,
  JMAP_MAIL,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart gateway attachment capability", () => {
  it("advertises native conversations after the gateway contract is present", () => {
    expect(
      new StalwartProviderModule().manifest.capabilities.supportsThreads,
    ).toBe(true);
  });

  it("shares rotated OAuth state with later gateway operations", async () => {
    const fetchMock = vi.fn(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = new URL(String(input));
        if (url.pathname === "/auth/token") {
          expect(String(init?.body)).toContain(
            "refresh_token=single-use-refresh",
          );
          return Response.json({
            access_token: "fresh-access",
            expires_in: 3_600,
            refresh_token: "rotated-refresh",
            token_type: "Bearer",
          });
        }
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer fresh-access",
        });
        if (url.pathname === "/.well-known/jmap") {
          return Response.json({
            accounts: { account: { isReadOnly: false, name: "User" } },
            apiUrl: "https://mail.example.com/jmap",
            capabilities: { [JMAP_CORE]: { maxSizeUpload: 1_024 } },
            downloadUrl: "https://mail.example.com/download",
            primaryAccounts: { [JMAP_MAIL]: "account" },
            uploadUrl: "https://mail.example.com/upload",
            username: "user@example.com",
          });
        }
        expect(url.pathname).toBe("/jmap");
        return Response.json({
          methodResponses: [
            [
              "Mailbox/get",
              { accountId: "account", list: [], state: "state" },
              "mailboxes",
            ],
          ],
          sessionState: "session-state",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new StalwartMailGateway({
      authType: "bearer",
      baseUrl: "https://mail.example.com",
      expiresAt: new Date(0).toISOString(),
      oauthClientId: "client",
      refreshToken: "single-use-refresh",
      secret: "expired-access",
      username: "user@example.com",
    });

    await expect(gateway.getMaxAttachmentBytes()).resolves.toBe(1_024);
    await expect(gateway.testConnection()).resolves.toBeUndefined();

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith("/auth/token"),
      ),
    ).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
