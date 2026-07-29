import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  ComposerAttachmentUploadRegistry,
  expireComposerAttachments,
  EXPIRED_ATTACHMENT_MESSAGE,
  invalidateReadyComposerAttachments,
  markComposerAttachmentReady,
} from "@/presentation/features/mail-workspace/hooks/composer-attachment-upload-registry";

const draftId = id.draft("composer-draft");
const upload = {
  expiresAt: "2026-07-29T01:00:00.000Z",
  id: id.attachmentUpload("completed-upload"),
  mimeType: "text/plain",
  name: "notes.txt",
  size: 5,
};

describe("composer attachment upload registry", () => {
  it("deletes an upload that completes after its row was removed", async () => {
    const registry = new ComposerAttachmentUploadRegistry();
    const operation = registry.begin("upload-key", draftId);
    const removeUpload = vi.fn(async () => undefined);

    expect(registry.cancel("upload-key")).toBe(operation);
    await expect(
      registry.complete("upload-key", operation, upload, removeUpload),
    ).resolves.toBe(false);

    expect(operation.controller.signal.aborted).toBe(true);
    expect(removeUpload).toHaveBeenCalledOnce();
    expect(removeUpload).toHaveBeenCalledWith(draftId, upload.id);
    expect(markComposerAttachmentReady([], "upload-key", upload)).toEqual([]);
  });

  it("retains completion metadata so removal wins before a UI commit", async () => {
    const registry = new ComposerAttachmentUploadRegistry();
    const operation = registry.begin("upload-key", draftId);
    const removeUpload = vi.fn(async () => undefined);

    await expect(
      registry.complete("upload-key", operation, upload, removeUpload),
    ).resolves.toBe(true);
    expect(registry.cancel("upload-key")?.upload).toBe(upload);
    expect(removeUpload).not.toHaveBeenCalled();
  });

  it("keeps late cleanup best-effort when deletion fails", async () => {
    const registry = new ComposerAttachmentUploadRegistry();
    const operation = registry.begin("upload-key", draftId);
    const removeUpload = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    registry.cancelAll();

    await expect(
      registry.complete("upload-key", operation, upload, removeUpload),
    ).resolves.toBe(false);
    expect(removeUpload).toHaveBeenCalledWith(draftId, upload.id);
  });

  it("marks expired and server-invalidated ready uploads as actionable errors", () => {
    const ready = [
      {
        error: null,
        key: "upload-key",
        name: upload.name,
        size: upload.size,
        state: "ready" as const,
        upload,
      },
    ];

    expect(
      expireComposerAttachments(ready, Date.parse(upload.expiresAt)),
    ).toMatchObject([{ error: EXPIRED_ATTACHMENT_MESSAGE, state: "error" }]);
    expect(
      invalidateReadyComposerAttachments(ready, "Attach this file again."),
    ).toMatchObject([{ error: "Attach this file again.", state: "error" }]);
  });
});
