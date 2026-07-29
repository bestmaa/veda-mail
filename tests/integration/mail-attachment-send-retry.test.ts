import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getMaxAttachmentBytes = vi.fn(async () => 18 * 1024 * 1024);
  const sendMessage = vi.fn(async () => ({
    id: "sent-after-retry",
    submittedAt: "2026-07-29T00:00:00.000Z",
  }));
  return {
    getMaxAttachmentBytes,
    mailService: vi.fn(async () => ({ getMaxAttachmentBytes, sendMessage })),
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: async () => ({
    id: "attachment-retry-connection",
    providerId: "mock",
  }),
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.mailService,
}));

import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import { OutgoingMessageSizeError } from "@/domain/mail/mail-errors";

const origin = "https://mail.example.com";
const headers = { host: "mail.example.com", origin };
const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

const sendDraft = (draftId: string, attachmentId: string) =>
  send(
    new Request(`${origin}/api/v1/mail/send`, {
      body: JSON.stringify({
        attachmentIds: [attachmentId],
        body: "Retry-safe attachment.",
        draftId,
        subject: "Retry",
        to: [{ email: "recipient@example.com", name: null }],
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );

const reserveAndUpload = async () => {
  const draftId = crypto.randomUUID();
  const content = "retryable bytes";
  const reserved = await reserve(
    new Request(`${origin}/api/v1/mail/attachments`, {
      body: JSON.stringify({
        declaredMimeType: "text/plain",
        draftId,
        fileName: "retry.txt",
        size: Buffer.byteLength(content),
      }),
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
    }),
  );
  expect(reserved.status).toBe(201);
  const payload = (await reserved.json()) as { data: { id: string } };
  const uploaded = await upload(
    new Request(`${origin}/api/v1/mail/attachments/${payload.data.id}`, {
      body: content,
      headers: {
        ...headers,
        "content-length": String(Buffer.byteLength(content)),
        "content-type": "text/plain",
        "x-veda-draft-id": draftId,
      },
      method: "PUT",
    }),
    route(payload.data.id),
  );
  expect(uploaded.status).toBe(200);
  return { attachmentId: payload.data.id, draftId };
};

beforeEach(() => {
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(18 * 1024 * 1024);
  mocks.mailService.mockClear();
  mocks.sendMessage.mockClear();
});

describe("attachment send retry", () => {
  it("keeps clean ciphertext retryable after capability discovery fails", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();

    mocks.getMaxAttachmentBytes.mockRejectedValueOnce(
      new Error("provider session unavailable"),
    );
    const first = await sendDraft(draftId, attachmentId);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_CAPABILITY_UNAVAILABLE" },
    });

    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });

  it("returns an actionable 413 and releases the attachment claim for retry", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    mocks.sendMessage.mockRejectedValueOnce(new OutgoingMessageSizeError());

    const first = await sendDraft(draftId, attachmentId);
    expect(first.status).toBe(413);
    await expect(first.json()).resolves.toMatchObject({
      error: {
        code: "ATTACHMENT_MESSAGE_TOO_LARGE",
        message: expect.stringContaining(
          "Reduce the message body or attachments",
        ),
      },
    });

    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });
});
