import "server-only";

import { createHash } from "node:crypto";

import {
  deleteEncryptedAttachment,
  readEncryptedAttachment,
} from "@/server/attachments/attachment-crypto-store";
import {
  assertUnexpired,
  attachmentSnapshot,
  authorizeAttachment,
  transitionAttachment,
  type StoredAttachment,
} from "@/server/attachments/attachment-record";
import type {
  AttachmentScope,
  AttachmentSnapshot,
  AttachmentState,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

export interface AttachmentOperationsContext {
  readonly directory: string;
  readonly key: Buffer;
  readonly now: () => number;
  readonly records: Map<string, StoredAttachment>;
}

const rejectable = new Set<AttachmentState>([
  "reserved",
  "uploading",
  "quarantined",
  "clean",
  "claimed",
]);

const uniqueRecords = (
  context: AttachmentOperationsContext,
  ids: readonly string[],
  scope: AttachmentScope,
): readonly StoredAttachment[] => {
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new AttachmentQuarantineError(
      "Attachment selection is invalid.",
      "INVALID_ATTACHMENT_SELECTION",
      400,
    );
  }
  return ids.map((id) =>
    authorizeAttachment(context.records.get(id), context.key, scope),
  );
};

const stateError = (message: string): AttachmentQuarantineError =>
  new AttachmentQuarantineError(message, "ATTACHMENT_STATE_CONFLICT", 409);

export const claimAttachments = (
  context: AttachmentOperationsContext,
  ids: readonly string[],
  scope: AttachmentScope,
): readonly AttachmentSnapshot[] => {
  const records = uniqueRecords(context, ids, scope);
  for (const record of records) {
    assertUnexpired(record, context.now());
    if (record.state !== "clean" || record.operation) {
      throw stateError("Attachment is not ready to send.");
    }
  }
  records.forEach((record) => transitionAttachment(record, "claimed"));
  return records.map(attachmentSnapshot);
};

export const releaseAttachments = (
  context: AttachmentOperationsContext,
  ids: readonly string[],
  scope: AttachmentScope,
): readonly AttachmentSnapshot[] => {
  const records = uniqueRecords(context, ids, scope);
  if (
    records.some(({ operation, state }) => state !== "claimed" || operation)
  ) {
    throw stateError("Attachment is not available to release.");
  }
  records.forEach((record) => transitionAttachment(record, "clean"));
  return records.map(attachmentSnapshot);
};

export const consumeAttachments = async (
  context: AttachmentOperationsContext,
  ids: readonly string[],
  scope: AttachmentScope,
): Promise<readonly AttachmentSnapshot[]> => {
  const records = uniqueRecords(context, ids, scope);
  if (
    records.some(({ operation, state }) => state !== "claimed" || operation)
  ) {
    throw stateError("Attachment is not available to consume.");
  }
  records.forEach((record) => transitionAttachment(record, "consumed"));
  try {
    await Promise.all(
      records.map((record) =>
        deleteEncryptedAttachment(context.directory, record.encryptedFile),
      ),
    );
    records.forEach((record) => {
      delete record.encryptedFile;
      context.records.delete(record.id);
    });
    return records.map(attachmentSnapshot);
  } catch {
    throw new AttachmentQuarantineError(
      "Consumed attachment cleanup failed.",
      "ATTACHMENT_STORAGE_UNAVAILABLE",
      503,
    );
  }
};

export const readClaimedAttachment = async (
  context: AttachmentOperationsContext,
  id: string,
  scope: AttachmentScope,
): Promise<Buffer> => {
  const record = authorizeAttachment(
    context.records.get(id),
    context.key,
    scope,
  );
  assertUnexpired(record, context.now());
  if (
    record.state !== "claimed" ||
    record.operation ||
    !record.encryptedFile ||
    !record.sha256
  ) {
    throw stateError("Attachment is not claimed for sending.");
  }
  const operation = new AbortController();
  record.operation = operation;
  try {
    const contents = await readEncryptedAttachment(
      context.directory,
      record.encryptedFile,
      id,
      record.contentLength,
      context.key,
    );
    if (
      operation.signal.aborted ||
      record.state !== "claimed" ||
      createHash("sha256").update(contents).digest("hex") !== record.sha256
    ) {
      throw new Error("Attachment integrity mismatch.");
    }
    return contents;
  } catch {
    if (record.state === "claimed") {
      transitionAttachment(record, "rejected");
    }
    await deleteEncryptedAttachment(
      context.directory,
      record.encryptedFile,
    ).catch(() => undefined);
    delete record.encryptedFile;
    throw new AttachmentQuarantineError(
      "Attachment storage integrity check failed.",
      "ATTACHMENT_INTEGRITY_FAILED",
      500,
    );
  } finally {
    if (record.operation === operation) {
      delete record.operation;
    }
  }
};

export const cleanupExpiredAttachments = async (
  context: AttachmentOperationsContext,
): Promise<number> => {
  const expired = [...context.records.values()].filter(
    ({ expiresAt }) => expiresAt <= context.now(),
  );
  const removals: Promise<void>[] = [];
  for (const record of expired) {
    if (record.operation) {
      record.operation.abort();
      if (rejectable.has(record.state)) {
        transitionAttachment(record, "rejected");
      }
      continue;
    }
    // Keep the original quota-counted state until durable cleanup succeeds.
    removals.push(
      deleteEncryptedAttachment(context.directory, record.encryptedFile).then(
        () => {
          context.records.delete(record.id);
        },
      ),
    );
  }
  await Promise.all(removals);
  return expired.length;
};

export const removeAttachment = async (
  context: AttachmentOperationsContext,
  id: string,
  scope: AttachmentScope,
): Promise<void> => {
  let record: StoredAttachment;
  try {
    record = authorizeAttachment(context.records.get(id), context.key, scope);
  } catch (error) {
    if (
      error instanceof AttachmentQuarantineError &&
      error.code === "ATTACHMENT_NOT_FOUND"
    ) {
      return;
    }
    throw error;
  }
  record.operation?.abort();
  if (rejectable.has(record.state)) {
    transitionAttachment(record, "rejected");
  }
  try {
    await deleteEncryptedAttachment(context.directory, record.encryptedFile);
    context.records.delete(id);
  } catch {
    throw new AttachmentQuarantineError(
      "Attachment removal could not be completed.",
      "ATTACHMENT_STORAGE_UNAVAILABLE",
      503,
    );
  }
};
