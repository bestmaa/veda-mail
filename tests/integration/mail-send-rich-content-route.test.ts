import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({ sendMessage: mocks.sendMessage })),
}));

import { POST } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;

const request = (overrides: Readonly<Record<string, unknown>> = {}) =>
  new Request(`${origin}/api/v1/mail/send`, {
    body: JSON.stringify({
      body: "Client fallback",
      draftId: crypto.randomUUID(),
      subject: "Rich route",
      to: [{ email: "recipient@example.com", name: null }],
      ...overrides,
    }),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
    },
    method: "POST",
  });

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Rich route",
      providerId: id.provider("mock"),
    },
    "rich-route-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue({
    deliveryStatus: "accepted",
    id: "sent-message",
    rejectedRecipients: [],
    submittedAt: "2026-07-30T12:00:00.000Z",
  });
});

describe("rich mail send route", () => {
  it("sanitizes HTML and derives plain text before provider submission", async () => {
    const response = await POST(
      request({
        body: "Divergent text must not reach the provider.",
        htmlBody:
          '<p style="background:url(https://tracker.invalid)">' +
          "<b>Rich</b> message" +
          '<img src="https://tracker.invalid/pixel" onerror="alert(1)">' +
          "<script>PRIVATE_SCRIPT()</script></p>",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      attachments: [],
      bcc: [],
      body: "Rich message",
      cc: [],
      htmlBody: "<p><strong>Rich</strong> message</p>",
      subject: "Rich route",
      to: [{ email: "recipient@example.com", name: null }],
    });
    expect(JSON.stringify(mocks.sendMessage.mock.calls[0]?.[0])).not.toMatch(
      /(?:Divergent|PRIVATE_SCRIPT|tracker\.invalid|onerror|style=)/iu,
    );
  });

  it("rejects rich content that has no readable alternative", async () => {
    const response = await POST(
      request({
        htmlBody:
          "<script>only active content</script>" +
          '<img src="https://tracker.invalid/pixel">',
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_MESSAGE_CONTENT",
        message: "The message body contains invalid or unsupported content.",
      },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
