import "server-only";

import {
  deleteEncryptedAttachment,
  discardEncryptedUpload,
  writeEncryptedUpload,
} from "@/server/attachments/attachment-crypto-store";
import {
  assertUnexpired,
  attachmentSnapshot,
  transitionAttachment,
  type StoredAttachment,
} from "@/server/attachments/attachment-record";
import {
  commitAttachmentOperation,
  runAttachmentOperation,
} from "@/server/attachments/attachment-operation";
import {
  detectAttachmentMime,
  scanAttachmentFailClosed,
} from "@/server/attachments/attachment-upload-inspection";
import type {
  AttachmentBody,
  AttachmentMimeDetector,
  AttachmentScanner,
  AttachmentSnapshot,
  AttachmentState,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

interface UploadContext {
  readonly directory: string;
  readonly key: Buffer;
  readonly maximumBytes: number;
  readonly mimeDetector: AttachmentMimeDetector;
  readonly now: () => number;
  readonly records: Map<string, StoredAttachment>;
  readonly scanner: AttachmentScanner;
  readonly signal?: AbortSignal;
  readonly uploadIdleTimeoutMs: number;
  readonly uploadTimeoutMs: number;
}

const reject = (record: StoredAttachment): void => {
  const rejectable = new Set<AttachmentState>([
    "reserved",
    "uploading",
    "quarantined",
    "clean",
    "claimed",
  ]);
  if (rejectable.has(record.state)) {
    transitionAttachment(record, "rejected");
  }
};

const isRejected = (record: StoredAttachment): boolean =>
  record.state === "rejected";

const aborted = (): AttachmentQuarantineError =>
  new AttachmentQuarantineError(
    "Attachment upload was aborted.",
    "ATTACHMENT_UPLOAD_ABORTED",
    409,
  );

const assertActive = (
  context: UploadContext,
  record: StoredAttachment,
  id: string,
  state: AttachmentState,
): void => {
  if (
    context.records.get(id) !== record ||
    record.state !== state ||
    record.expiresAt <= context.now()
  ) {
    throw new AttachmentQuarantineError(
      "Attachment reservation expired.",
      "ATTACHMENT_EXPIRED",
      410,
    );
  }
};

export const uploadQuarantinedAttachment = async (
  context: UploadContext,
  record: StoredAttachment,
  id: string,
  body: AttachmentBody,
  contentLength: number,
): Promise<AttachmentSnapshot> => {
  assertUnexpired(record, context.now());
  if (context.signal?.aborted) {
    throw aborted();
  }
  if (record.state !== "reserved") {
    throw new AttachmentQuarantineError(
      "Attachment is not ready for upload.",
      "ATTACHMENT_STATE_CONFLICT",
      409,
    );
  }
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength !== record.contentLength
  ) {
    throw new AttachmentQuarantineError(
      "Attachment body does not match Content-Length.",
      "ATTACHMENT_LENGTH_MISMATCH",
      400,
    );
  }
  transitionAttachment(record, "uploading");
  const controller = new AbortController();
  record.operation = controller;
  const onExternalAbort = (): void => controller.abort();
  context.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (context.signal?.aborted) onExternalAbort();
  let timedOut = false;
  let idleDeadline: NodeJS.Timeout | undefined;
  const armIdleDeadline = () => {
    clearTimeout(idleDeadline);
    idleDeadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, context.uploadIdleTimeoutMs);
    idleDeadline.unref();
  };
  armIdleDeadline();
  const uploadDeadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, context.uploadTimeoutMs);
  uploadDeadline.unref();
  let encrypted: Awaited<ReturnType<typeof writeEncryptedUpload>> | undefined;
  try {
    encrypted = await writeEncryptedUpload({
      abort: () => controller.abort(),
      attachmentId: id,
      body,
      directory: context.directory,
      expectedBytes: contentLength,
      key: context.key,
      maximumBytes: context.maximumBytes,
      onProgress: armIdleDeadline,
      scanner: scanAttachmentFailClosed(context.scanner),
      signal: controller.signal,
    });
    const completedUpload = encrypted;
    assertActive(context, record, id, "uploading");
    transitionAttachment(record, "quarantined");
    if (completedUpload.scanResult.verdict !== "clean") {
      throw new AttachmentQuarantineError(
        "Attachment was rejected by malware scanning.",
        "ATTACHMENT_REJECTED",
        422,
      );
    }
    record.detectedMimeType = await runAttachmentOperation(
      controller.signal,
      () =>
        detectAttachmentMime(
          context.mimeDetector,
          record,
          completedUpload.sample,
        ),
    );
    assertActive(context, record, id, "quarantined");
    record.sha256 = completedUpload.sha256;
    record.encryptedFile = await commitAttachmentOperation(
      controller.signal,
      context.directory,
      completedUpload,
    );
    assertActive(context, record, id, "quarantined");
    transitionAttachment(record, "clean");
    return attachmentSnapshot(record);
  } catch (error) {
    if (encrypted) {
      await discardEncryptedUpload(encrypted);
    }
    await deleteEncryptedAttachment(
      context.directory,
      record.encryptedFile,
    ).catch(() => undefined);
    delete record.encryptedFile;
    reject(record);
    if (timedOut) {
      throw new AttachmentQuarantineError(
        "Attachment upload timed out.",
        "ATTACHMENT_UPLOAD_TIMEOUT",
        408,
      );
    }
    if (record.expiresAt <= context.now()) {
      throw new AttachmentQuarantineError(
        "Attachment reservation expired.",
        "ATTACHMENT_EXPIRED",
        410,
      );
    }
    if (context.signal?.aborted) {
      throw aborted();
    }
    if (error instanceof AttachmentQuarantineError) {
      throw error;
    }
    throw new AttachmentQuarantineError(
      "Attachment quarantine storage is unavailable.",
      "ATTACHMENT_STORAGE_UNAVAILABLE",
      503,
    );
  } finally {
    context.signal?.removeEventListener("abort", onExternalAbort);
    clearTimeout(idleDeadline);
    clearTimeout(uploadDeadline);
    delete record.operation;
    if (record.expiresAt <= context.now() && isRejected(record)) {
      context.records.delete(id);
    }
  }
};
