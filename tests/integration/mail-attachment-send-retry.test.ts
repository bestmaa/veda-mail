import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getMaxAttachmentBytes = vi.fn(async () => 18 * 1024 * 1024);
  const sendMessage = vi.fn(async (): Promise<unknown> => ({
    deliveryStatus: "accepted",
    id: "sent-after-retry",
    rejectedRecipients: [] as string[],
    submittedAt: "2026-07-29T00:00:00.000Z",
  }));
  return {
    getCurrentConnection: vi.fn(),
    getMaxAttachmentBytes,
    mailService: vi.fn(async () => ({ getMaxAttachmentBytes, sendMessage })),
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.mailService,
}));

import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import {
  MessageDeliveryRejectedError,
  OutgoingMessageSizeError,
} from "@/domain/mail/mail-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { attachmentService } from "@/server/mail/attachment-service";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;
const headers = { host: "mail.example.com", origin };
const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

const sendDraft = (
  draftId: string,
  attachmentId: string,
  to = [{ email: "recipient@example.com", name: null }],
) =>
  send(
    new Request(`${origin}/api/v1/mail/send`, {
      body: JSON.stringify({
        attachmentIds: [attachmentId],
        body: "Retry-safe attachment.",
        draftId,
        subject: "Retry",
        to,
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
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Attachment retry",
      providerId: id.provider("mock"),
    },
    "attachment-retry-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(18 * 1024 * 1024);
  mocks.mailService.mockClear();
  mocks.sendMessage.mockClear();
});

describe("attachment send retry", () => {
  it("coalesces concurrent attachment sends into one claim and provider call", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    const claim = vi.spyOn(attachmentService(), "claim");
    const provider = Promise.withResolvers<unknown>();
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockReturnValue(provider.promise);
    const first = sendDraft(draftId, attachmentId);
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    const begin = vi.spyOn(connectionStore, "beginSendIfActive");
    const second = sendDraft(draftId, attachmentId);
    await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
    provider.resolve({
      deliveryStatus: "accepted",
      id: "concurrent-terminal",
      rejectedRecipients: [],
      submittedAt: "2026-07-30T00:00:00.000Z",
    });
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(await secondResponse.json()).toEqual(await firstResponse.json());
    expect(claim).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    claim.mockRestore();
    begin.mockRestore();
  });
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

  it("releases the claim when every recipient is rejected", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    mocks.sendMessage.mockRejectedValueOnce(new MessageDeliveryRejectedError());

    const rejected = await sendDraft(draftId, attachmentId);
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "MAIL_RECIPIENTS_REJECTED" },
    });

    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("consumes the attachment after terminal partial delivery", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    const claim = vi.spyOn(attachmentService(), "claim");
    mocks.sendMessage.mockResolvedValueOnce({
      deliveryStatus: "partial",
      id: "partially-sent",
      rejectedRecipients: ["recipient@example.com"],
      submittedAt: "2026-07-30T00:00:00.000Z",
    });

    const recipients = [
      { email: "accepted@example.com", name: null },
      { email: "recipient@example.com", name: null },
    ];
    const partial = await sendDraft(draftId, attachmentId, recipients);
    expect(partial.status).toBe(201);

    const duplicate = await sendDraft(draftId, attachmentId, recipients);
    expect(duplicate.status).toBe(201);
    await expect(duplicate.json()).resolves.toEqual(await partial.clone().json());
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    claim.mockRestore();
  });

  it("consumes the attachment after an uncertain provider receipt", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    const claim = vi.spyOn(attachmentService(), "claim");
    const providerSecret = "provider-secret@example.com";
    mocks.sendMessage.mockResolvedValueOnce({
      deliveryStatus: "partial",
      id: providerSecret,
      rejectedRecipients: [providerSecret],
      submittedAt: "invalid",
    });

    const uncertain = await sendDraft(draftId, attachmentId);
    expect(uncertain.status).toBe(201);
    const payload = await uncertain.json();
    expect(payload).toMatchObject({
      data: {
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      },
    });
    expect(JSON.stringify(payload)).not.toContain(providerSecret);

    const duplicate = await sendDraft(draftId, attachmentId);
    expect(duplicate.status).toBe(201);
    await expect(duplicate.json()).resolves.toEqual(payload);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    claim.mockRestore();
  });
});
