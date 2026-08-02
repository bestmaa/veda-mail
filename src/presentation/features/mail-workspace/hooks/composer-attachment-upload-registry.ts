import type { Attachment, UploadedAttachment } from "@/domain/mail/mail";
import type {
  AttachmentId,
  AttachmentUploadId,
  DraftId,
  MessageId,
} from "@/domain/shared/brand";

export type RemoveUploadedAttachment = (
  draftId: DraftId,
  attachmentId: AttachmentUploadId,
) => Promise<void>;

export interface ComposerAttachmentUploadOperation {
  readonly controller: AbortController;
  readonly draftId: DraftId;
  upload: UploadedAttachment | null;
}

export interface ComposerAttachment {
  readonly error: string | null;
  readonly key: string;
  readonly upload: UploadedAttachment | null;
  readonly name: string;
  readonly provider?: Attachment;
  readonly size: number | null;
  readonly source?: {
    readonly attachmentId: AttachmentId;
    readonly messageId: MessageId;
  };
  readonly state: "error" | "ready" | "uploading";
}

export const EXPIRED_ATTACHMENT_MESSAGE =
  "This attachment expired. Remove it and attach the file again.";

export const expireComposerAttachments = (
  attachments: readonly ComposerAttachment[],
  now: number,
): readonly ComposerAttachment[] =>
  attachments.map((item) => {
    if (item.state !== "ready" || !item.upload) return item;
    const expiresAt = Date.parse(item.upload.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now
      ? item
      : { ...item, error: EXPIRED_ATTACHMENT_MESSAGE, state: "error" };
  });

export const invalidateReadyComposerAttachments = (
  attachments: readonly ComposerAttachment[],
  message: string,
): readonly ComposerAttachment[] =>
  attachments.map((item) =>
    item.state === "ready" ? { ...item, error: message, state: "error" } : item,
  );

export const markComposerAttachmentReady = (
  attachments: readonly ComposerAttachment[],
  key: string,
  upload: UploadedAttachment,
): readonly ComposerAttachment[] =>
  attachments.map((item) =>
    item.key === key
      ? {
          ...item,
          name: upload.name,
          size: upload.size,
          state: "ready",
          upload,
        }
      : item,
  );

export const cleanupComposerAttachmentOperations = (
  operations: readonly ComposerAttachmentUploadOperation[],
  removeUpload: RemoveUploadedAttachment,
): ReadonlySet<AttachmentUploadId> => {
  const attachmentIds = new Set<AttachmentUploadId>();
  for (const operation of operations) {
    if (!operation.upload) continue;
    attachmentIds.add(operation.upload.id);
    void removeUpload(operation.draftId, operation.upload.id).catch(
      () => undefined,
    );
  }
  return attachmentIds;
};

export class ComposerAttachmentUploadRegistry {
  private readonly operations = new Map<
    string,
    ComposerAttachmentUploadOperation
  >();

  begin(key: string, draftId: DraftId): ComposerAttachmentUploadOperation {
    const operation = {
      controller: new AbortController(),
      draftId,
      upload: null,
    };
    this.operations.set(key, operation);
    return operation;
  }

  cancel(key: string): ComposerAttachmentUploadOperation | null {
    const operation = this.operations.get(key) ?? null;
    if (!operation) return null;
    this.operations.delete(key);
    operation.controller.abort();
    return operation;
  }

  cancelAll(): readonly ComposerAttachmentUploadOperation[] {
    const operations = [...this.operations.values()];
    this.operations.clear();
    for (const operation of operations) operation.controller.abort();
    return operations;
  }

  fail(key: string, operation: ComposerAttachmentUploadOperation): void {
    if (this.operations.get(key) === operation) this.operations.delete(key);
  }

  async complete(
    key: string,
    operation: ComposerAttachmentUploadOperation,
    upload: UploadedAttachment,
    removeUpload: RemoveUploadedAttachment,
  ): Promise<boolean> {
    operation.upload = upload;
    if (
      this.operations.get(key) === operation &&
      !operation.controller.signal.aborted
    ) {
      return true;
    }
    void removeUpload(operation.draftId, upload.id).catch(() => undefined);
    return false;
  }
}
