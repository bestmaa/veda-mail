import "server-only";

import { createHash } from "node:crypto";

import { decryptEncryptedAttachment } from
  "@/server/attachments/attachment-crypto-decrypt";
import {
  assertUnexpired,
  attachmentStateConflict,
  authorizeAttachment,
  transitionAttachment,
} from "@/server/attachments/attachment-record";
import type { SharedAttachmentRepository } from
  "@/server/attachments/shared-attachment-repository";
import type { AttachmentScope } from
  "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from
  "@/server/attachments/attachment-types";
import { ApiError } from "@/transport/http/api-error";

export const readSharedClaimedAttachment = async (
  repository: SharedAttachmentRepository,
  key: Buffer,
  now: () => number,
  id: string,
  scope: AttachmentScope,
): Promise<Buffer> => repository.withLock(async () => {
  const record = authorizeAttachment(await repository.get(id), key, scope);
  assertUnexpired(record, now());
  if (record.state !== "claimed" || !record.sha256) {
    attachmentStateConflict("Attachment is not claimed for sending.");
  }
  try {
    const plaintext = decryptEncryptedAttachment(
      await repository.getBlob(id), id, record.contentLength, key,
    );
    if (createHash("sha256").update(plaintext).digest("hex") !== record.sha256) {
      throw new Error("Attachment integrity mismatch.");
    }
    return plaintext;
  } catch (error) {
    if (error instanceof ApiError &&
      error.code === "ATTACHMENT_STORAGE_UNAVAILABLE") throw error;
    transitionAttachment(record, "rejected");
    await repository.removeBlob(id);
    await repository.put(record);
    throw new AttachmentQuarantineError(
      "Attachment storage integrity check failed.",
      "ATTACHMENT_INTEGRITY_FAILED", 500,
    );
  }
});
