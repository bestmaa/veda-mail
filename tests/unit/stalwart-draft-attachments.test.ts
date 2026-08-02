import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DraftContent, DraftSaveInput } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { bindJmapReceivedAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  resolveStalwartDraftAttachments,
  sameJmapDraftAttachments,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-attachments";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

const composeId = id.draft("11111111-1111-4111-8111-111111111111");
const content: DraftContent = {
  bcc: [], body: "Body", cc: [], subject: "Subject", to: [],
};
const existing = {
  attachments: [{
    blobId: "provider-blob", disposition: "attachment", name: "kept.txt",
    partId: "part-1", size: 4, type: "text/plain",
  }],
  hasAttachment: true,
  id: "draft-1",
  keywords: { $draft: true },
  mailboxIds: { drafts: true },
  receivedAt: "2026-08-02T00:00:00.000Z",
  subject: "Subject",
} as unknown as JmapDraftEmail;

const uploaded = (sha256?: string) => {
  const bytes = Buffer.from("clean bytes");
  return {
    content: bytes,
    id: id.attachmentUpload("upload-1"),
    mimeType: "text/plain",
    name: "new.txt",
    sha256: sha256 ?? createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
};

describe("Stalwart durable draft attachments", () => {
  it("retains only opaque attachments bound to the exact provider draft", async () => {
    const retainedId = bindJmapReceivedAttachments("account", existing)[0]!
      .metadata.id;
    const client = { uploadAttachment: vi.fn() } as unknown as StalwartJmapClient;
    const input = {
      composeId, content, expectedRevision: "revision",
      providerDraftId: id.providerDraft("draft-1"),
      retainedAttachmentIds: [retainedId],
    } satisfies DraftSaveInput;

    const resolved = await resolveStalwartDraftAttachments(
      client, "account", input, existing,
    );

    expect(resolved).toEqual([
      { blobId: "provider-blob", name: "kept.txt", type: "text/plain" },
    ]);
    expect(sameJmapDraftAttachments("account", existing, resolved)).toBe(true);
    await expect(resolveStalwartDraftAttachments(client, "account", {
      ...input, retainedAttachmentIds: [id.attachment("forged")],
    }, existing)).rejects.toMatchObject({ name: "DraftConflictError" });
  });

  it("uploads verified bytes and rejects digest tampering before provider access", async () => {
    const uploadAttachment = vi.fn(async () => ({
      blobId: "new-blob", type: "text/plain",
    }));
    const client = { uploadAttachment } as unknown as StalwartJmapClient;
    const input = { attachments: [uploaded()], composeId, content };

    await expect(resolveStalwartDraftAttachments(
      client, "account", input,
    )).resolves.toEqual([
      { blobId: "new-blob", name: "new.txt", type: "text/plain" },
    ]);
    await expect(resolveStalwartDraftAttachments(client, "account", {
      ...input, attachments: [uploaded("0".repeat(64))],
    })).rejects.toThrow("integrity");
    expect(uploadAttachment).toHaveBeenCalledOnce();
  });

  it("rejects an oversized combined selection before uploading", async () => {
    const retainedId = bindJmapReceivedAttachments("account", existing)[0]!
      .metadata.id;
    const uploadAttachment = vi.fn();
    const client = { uploadAttachment } as unknown as StalwartJmapClient;
    const input = {
      attachments: Array.from({ length: 10 }, () => uploaded()),
      composeId, content, expectedRevision: "revision",
      providerDraftId: id.providerDraft("draft-1"),
      retainedAttachmentIds: [retainedId],
    } satisfies DraftSaveInput;

    await expect(resolveStalwartDraftAttachments(
      client, "account", input, existing,
    )).rejects.toMatchObject({ name: "DraftConflictError" });
    expect(uploadAttachment).not.toHaveBeenCalled();
  });
});
