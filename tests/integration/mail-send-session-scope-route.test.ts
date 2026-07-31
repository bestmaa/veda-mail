import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));

import { POST } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Session scope route",
      providerId: id.provider("mock"),
    },
    "session-scope-route-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.getMailService.mockReset();
  mocks.sendMessage.mockReset();
});

describe("mail send session scope", () => {
  it("rejects a stale scope before invoking a provider", async () => {
    const response = await POST(
      new Request(`${origin}/api/v1/mail/send`, {
        body: JSON.stringify({
          body: "Must not be sent.",
          draftId: crypto.randomUUID(),
          subject: "Stale scope",
          to: [{ email: "recipient@example.com", name: null }],
        }),
        headers: {
          "content-type": "application/json",
          host: "mail.example.com",
          origin,
          "x-veda-mail-session-scope": mailSessionScope({
            id: id.connection("stale-route-test-connection"),
          }),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MAIL_SESSION_CHANGED",
        message: "Mailbox session changed. Reload this page and try again.",
      },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
