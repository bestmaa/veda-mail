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

import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
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
      displayName: "Attachment terminal outcomes",
      providerId: id.provider("mock"),
    },
    "attachment-terminal-outcomes-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.getMaxAttachmentBytes.mockReset();
  mocks.getMaxAttachmentBytes.mockResolvedValue(18 * 1024 * 1024);
  mocks.mailService.mockClear();
  mocks.sendMessage.mockReset();
});

describe("attachment send terminal outcomes", () => {
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
