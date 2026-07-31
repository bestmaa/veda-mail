import { beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  MAX_SEND_IDEMPOTENCY_PER_CONNECTION,
  sendIdempotencyStore,
} from "@/server/mail/send-idempotency-store";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;

const request = (draftId: string): Request =>
  new Request(`${origin}/api/v1/mail/send`, {
    body: JSON.stringify({
      body: "Lifecycle body",
      draftId,
      subject: "Lifecycle",
      to: [{ email: "recipient@example.com", name: null }],
    }),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(activeConnection),
    },
    method: "POST",
  });

const accepted = {
  deliveryStatus: "accepted" as const,
  id: "provider-terminal-id",
  rejectedRecipients: [] as string[],
  submittedAt: "2026-07-30T12:00:00.000Z",
};

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Lifecycle route",
      providerId: id.provider("mock"),
    },
    "lifecycle-route-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.sendMessage.mockReset();
  mocks.sendMessage.mockResolvedValue(accepted);
});

describe("mail send idempotency lifecycle", () => {
  it("fails closed at capacity before invoking attachment or provider work", async () => {
    const expiresAt =
      Date.parse(activeConnection.createdAt) + 12 * 60 * 60 * 1_000;
    for (
      let index = 0;
      index < MAX_SEND_IDEMPOTENCY_PER_CONNECTION;
      index += 1
    ) {
      const draftId = id.draft(`filled-${index}`);
      const begun = sendIdempotencyStore.begin(
        activeConnection.id,
        draftId,
        index.toString(16).padStart(64, "0"),
        expiresAt,
      );
      if (begun.kind !== "owner") throw new Error("Expected ownership.");
      sendIdempotencyStore.complete(
        activeConnection.id,
        draftId,
        begun.token,
        {
          ...accepted,
          id: id.message(`filled-message-${index}`),
        },
      );
    }

    const response = await POST(request(crypto.randomUUID()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_SEND_IDEMPOTENCY_CAPACITY" },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("orphans a coalesced waiter and never recreates state after sign-out", async () => {
    const provider = Promise.withResolvers<unknown>();
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockReturnValue(provider.promise);
    const draftId = crypto.randomUUID();
    const owner = POST(request(draftId));
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    const begin = vi.spyOn(connectionStore, "beginSendIfActive");
    const waiter = POST(request(draftId));
    await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());

    connectionStore.remove(activeConnection.id);
    const waiterResponse = await waiter;
    expect(waiterResponse.status).toBe(409);
    await expect(waiterResponse.json()).resolves.toMatchObject({
      error: { code: "MAIL_SEND_SESSION_ENDED" },
    });

    provider.resolve(accepted);
    const ownerResponse = await owner;
    expect(ownerResponse.status).toBe(201);
    expect(connectionStore.get(activeConnection.id)).toBeNull();

    const afterSignOut = await POST(request(draftId));
    expect(afterSignOut.status).toBe(401);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    begin.mockRestore();
  });
});
