import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageDeliveryRejectedError } from "@/domain/mail/mail-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";

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
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;

const payload = (
  draftId: string,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  body: "Exactly once body",
  draftId,
  subject: "Exactly once",
  to: [{ email: "recipient@example.com", name: null }],
  ...overrides,
});

const request = (body: Readonly<Record<string, unknown>>): Request =>
  new Request(`${origin}/api/v1/mail/send`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(activeConnection),
    },
    method: "POST",
  });

const accepted = {
  deliveryStatus: "accepted",
  id: "provider-terminal-id",
  rejectedRecipients: [] as string[],
  submittedAt: "2026-07-30T12:00:00.000Z",
};

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Idempotency route",
      providerId: id.provider("mock"),
    },
    "idempotency-route-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue(accepted);
});

describe("mail send idempotency route", () => {
  it("replays a completed terminal receipt without resubmitting", async () => {
    const body = payload(crypto.randomUUID());

    const first = await POST(request(body));
    const replay = await POST(request(body));

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("fingerprints canonical provider content instead of hostile raw HTML", async () => {
    const draftId = crypto.randomUUID();
    const first = await POST(
      request(
        payload(draftId, {
          body: "First divergent client fallback",
          htmlBody: "<p>Hello <strong>team</strong></p>",
        }),
      ),
    );
    const replay = await POST(
      request(
        payload(draftId, {
          body: "Second divergent client fallback",
          htmlBody:
            "<p>Hello <b>team</b><script>PRIVATE_RETRY_DATA</script></p>",
        }),
      ),
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Hello team",
        htmlBody: "<p>Hello <strong>team</strong></p>",
      }),
    );
  });

  it("coalesces concurrent requests into one provider submission", async () => {
    const provider = Promise.withResolvers<unknown>();
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockReturnValue(provider.promise);
    const body = payload(crypto.randomUUID());

    const first = POST(request(body));
    const second = POST(request(body));
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    provider.resolve(accepted);
    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(await secondResponse.json()).toEqual(await firstResponse.json());
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("conflicts on a changed completed intent without leaking content", async () => {
    const draftId = crypto.randomUUID();
    const first = await POST(request(payload(draftId)));
    const privateBody = "private changed body 7b9f";
    const privateRecipient = "private-changed@example.com";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const conflict = await POST(
      request(
        payload(draftId, {
          bcc: [{ email: privateRecipient, name: null }],
          body: privateBody,
        }),
      ),
    );

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    const failure = await conflict.json();
    expect(failure).toMatchObject({
      error: { code: "MAIL_SEND_IDEMPOTENCY_CONFLICT" },
    });
    expect(JSON.stringify(failure)).not.toContain(privateBody);
    expect(JSON.stringify(failure)).not.toContain(privateRecipient);
    expect(log).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("releases a definitive rejection so the same intent can retry", async () => {
    mocks.sendMessage
      .mockRejectedValueOnce(new MessageDeliveryRejectedError())
      .mockResolvedValueOnce(accepted);
    const body = payload(crypto.randomUUID());

    const rejected = await POST(request(body));
    const retried = await POST(request(body));

    expect(rejected.status).toBe(422);
    expect(retried.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });
});
