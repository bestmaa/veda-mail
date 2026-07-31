import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const acquire = vi.fn();
  const release = vi.fn();
  const sendMessage = vi.fn();
  return {
    acquire,
    getCurrentConnection: vi.fn(),
    getMaxAttachmentBytes: vi.fn(async () => 18 * 1024 * 1024),
    release,
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/attachment-send-memory-budget", () => ({
  attachmentSendMemoryBudget: () => ({ acquire: mocks.acquire }),
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
    sendMessage: mocks.sendMessage,
  }),
}));

import { PUT as upload } from "@/app/api/v1/mail/attachments/[attachmentId]/route";
import { POST as reserve } from "@/app/api/v1/mail/attachments/route";
import { POST as send } from "@/app/api/v1/mail/send/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";
let activeConnection: ProviderConnection;
const headers = { host: "mail.example.com", origin };
const route = (attachmentId: string) => ({
  params: Promise.resolve({ attachmentId }),
});

const sendDraft = (draftId: string, attachmentId: string) =>
  send(
    new Request(`${origin}/api/v1/mail/send`, {
      body: JSON.stringify({
        attachmentIds: [attachmentId],
        body: "Memory-budgeted attachment.",
        draftId,
        subject: "Memory",
        to: [{ email: "recipient@example.com", name: null }],
      }),
      headers: {
        ...headers,
        "content-type": "application/json",
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "POST",
    }),
  );

const uploadAttachment = async (
  draftId: string,
  content: string,
): Promise<string> => {
  const reserved = await reserve(
    new Request(`${origin}/api/v1/mail/attachments`, {
      body: JSON.stringify({
        declaredMimeType: "text/plain",
        draftId,
        fileName: "memory.txt",
        size: Buffer.byteLength(content),
      }),
      headers: {
        ...headers,
        "content-type": "application/json",
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "POST",
    }),
  );
  const payload = (await reserved.json()) as { data: { id: string } };
  const uploaded = await upload(
    new Request(`${origin}/api/v1/mail/attachments/${payload.data.id}`, {
      body: content,
      headers: {
        ...headers,
        "content-length": String(Buffer.byteLength(content)),
        "content-type": "text/plain",
        "x-veda-draft-id": draftId,
        "x-veda-mail-session-scope": mailSessionScope(activeConnection),
      },
      method: "PUT",
    }),
    route(payload.data.id),
  );
  expect(uploaded.status).toBe(200);
  return payload.data.id;
};

beforeEach(() => {
  connectionStore.clearAll();
  activeConnection = connectionStore.create(
    {
      config: {},
      displayName: "Attachment memory",
      providerId: id.provider("mock"),
    },
    "attachment-memory-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(activeConnection);
  mocks.acquire.mockReset();
  mocks.acquire.mockResolvedValue({ release: mocks.release });
  mocks.getMaxAttachmentBytes.mockClear();
  mocks.release.mockClear();
  mocks.sendMessage.mockReset();
});

describe("attachment send memory integration", () => {
  it("returns a retryable structured 503 when capacity is busy", async () => {
    const content = "queued plaintext";
    const draftId = crypto.randomUUID();
    const attachmentId = await uploadAttachment(draftId, content);
    mocks.acquire.mockRejectedValueOnce(
      new ApiError(
        "Attachment sending is busy. Please wait and try again.",
        "ATTACHMENT_SEND_BUSY",
        503,
      ),
    );

    const busy = await sendDraft(draftId, attachmentId);
    expect(busy.status).toBe(503);
    await expect(busy.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_SEND_BUSY" },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    mocks.sendMessage.mockResolvedValueOnce({
      id: "sent-after-capacity-retry",
      submittedAt: "2026-07-29T00:00:00.000Z",
    });
    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("holds capacity through provider send and releases it for retry", async () => {
    const content = "bounded plaintext";
    const draftId = crypto.randomUUID();
    const attachmentId = await uploadAttachment(draftId, content);
    const enteredProvider = Promise.withResolvers<void>();
    const providerResult = Promise.withResolvers<{
      id: string;
      submittedAt: string;
    }>();
    mocks.sendMessage.mockImplementationOnce(async () => {
      enteredProvider.resolve();
      return providerResult.promise;
    });

    const pending = sendDraft(draftId, attachmentId);
    await enteredProvider.promise;
    expect(mocks.acquire).toHaveBeenCalledWith(Buffer.byteLength(content));
    expect(mocks.release).not.toHaveBeenCalled();

    providerResult.reject(
      new ApiError("Provider unavailable.", "PROVIDER_UNAVAILABLE", 503),
    );
    const failed = await pending;
    expect(failed.status).toBe(503);
    expect(mocks.release).toHaveBeenCalledOnce();

    mocks.sendMessage.mockResolvedValueOnce({
      id: "sent-after-memory-release",
      submittedAt: "2026-07-29T00:00:00.000Z",
    });
    const retry = await sendDraft(draftId, attachmentId);
    expect(retry.status).toBe(201);
    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
