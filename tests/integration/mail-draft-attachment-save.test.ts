import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  getMaxAttachmentBytes: vi.fn(async () => 18 * 1024 * 1024),
  saveDraft: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({
    getMaxAttachmentBytes: mocks.getMaxAttachmentBytes,
    saveDraft: mocks.saveDraft,
  }),
}));

import { POST as saveDraft } from "@/app/api/v1/mail/drafts/route";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { connectionStore } from "@/server/connections/connection-store";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import {
  attachmentScope,
  attachmentService,
} from "@/server/mail/attachment-service";
import { reserveAndUpload } from "./mail-attachment-send-test-support";

const origin = "https://mail.example.com";
let connection: ProviderConnection;

const request = (draftId: string, attachmentId: string) =>
  new Request(`${origin}/api/v1/mail/drafts`, {
    body: JSON.stringify({
      attachmentIds: [attachmentId],
      composeId: draftId,
      content: { body: "Durable draft" },
    }),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(connection),
    },
    method: "POST",
  });

beforeEach(() => {
  connectionStore.clearAll();
  connection = connectionStore.create(
    { config: {}, displayName: "Draft attachments", providerId: id.provider("mock") },
    "draft-attachment-revision",
  );
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.saveDraft.mockReset();
});

describe("provider draft attachment save route", () => {
  it("passes only verified bytes and consumes quarantine after provider durability", async () => {
    const upload = await reserveAndUpload(connection);
    mocks.saveDraft.mockImplementationOnce(async (input) => ({
      attachments: [], composeId: input.composeId, content: input.content,
      hasAttachments: true, hasTruncatedContent: false,
      hasUncertainSubmission: false, id: id.providerDraft("saved"),
      revision: "revision", updatedAt: new Date().toISOString(),
    }));

    const response = await saveDraft(request(upload.draftId, upload.attachmentId));

    expect(response.status).toBe(201);
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({
        content: Buffer.from("retryable bytes"), name: "retry.txt",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/), size: 15,
      })],
    }));
    await expect(attachmentService().inspect(
      upload.attachmentId,
      attachmentScope(connection, id.draft(upload.draftId)),
    )).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("releases verified bytes when the provider save fails", async () => {
    const upload = await reserveAndUpload(connection);
    mocks.saveDraft.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await saveDraft(request(upload.draftId, upload.attachmentId));

    expect(response.status).toBe(503);
    await expect(attachmentService().inspect(
      upload.attachmentId,
      attachmentScope(connection, id.draft(upload.draftId)),
    )).resolves.toMatchObject({ state: "clean" });
  });
});
