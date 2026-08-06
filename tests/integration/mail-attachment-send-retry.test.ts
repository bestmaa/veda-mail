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
    policy: vi.fn(),
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.mailService,
}));
vi.mock("@/server/organization/mail-content-policy.service", async (original) => ({
  ...(await original()),
  getMailContentPolicy: mocks.policy,
}));

import {
  MessageDeliveryRejectedError,
  OutgoingMessageSizeError,
} from "@/domain/mail/mail-errors";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { DEFAULT_MAIL_CONTENT_POLICY } from "@/domain/installation/mail-content-policy";
import { connectionStore } from "@/server/connections/connection-store";
import { attachmentService } from "@/server/mail/attachment-service";
import {
  reserveAndUpload as reserveAndUploadForConnection,
  sendDraft as sendDraftForConnection,
} from "./mail-attachment-send-test-support";

let activeConnection: ProviderConnection;

const sendDraft = (
  draftId: string,
  attachmentId: string,
  to = [{ email: "recipient@example.com", name: null }],
) => sendDraftForConnection(activeConnection, draftId, attachmentId, to);

const reserveAndUpload = () => reserveAndUploadForConnection(activeConnection);

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
  mocks.policy.mockReset();
  mocks.policy.mockResolvedValue(DEFAULT_MAIL_CONTENT_POLICY);
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

  it("releases a claim when policy changes after upload", async () => {
    const { attachmentId, draftId } = await reserveAndUpload();
    mocks.policy.mockResolvedValue({
      ...DEFAULT_MAIL_CONTENT_POLICY,
      blockedMimeTypes: ["text/plain"],
    });
    const blocked = await sendDraft(draftId, attachmentId);
    expect(blocked.status).toBe(422);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { code: "ORGANIZATION_MIME_TYPE_BLOCKED" },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    mocks.policy.mockResolvedValue(DEFAULT_MAIL_CONTENT_POLICY);
    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
  });
});
