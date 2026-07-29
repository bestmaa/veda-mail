import type {
  AttachmentQuotas,
  AttachmentScope,
  AttachmentSnapshot,
  AttachmentState,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";
import {
  bindingsEqual,
  deriveScopeBindings,
  notFoundError,
  type ScopeBindings,
} from "@/server/attachments/attachment-security";

export interface StoredAttachment {
  readonly bindings: ScopeBindings;
  readonly contentLength: number;
  readonly createdAt: number;
  readonly declaredMimeType: string;
  detectedMimeType?: string;
  readonly expiresAt: number;
  readonly fileName: string;
  readonly id: string;
  encryptedFile?: string;
  operation?: AbortController;
  sha256?: string;
  state: AttachmentState;
}

const allowedTransitions: Readonly<
  Record<AttachmentState, readonly AttachmentState[]>
> = {
  claimed: ["clean", "consumed", "rejected"],
  clean: ["claimed", "rejected"],
  consumed: [],
  quarantined: ["clean", "rejected"],
  rejected: [],
  reserved: ["uploading", "rejected"],
  uploading: ["quarantined", "rejected"],
};

const quotaStates = new Set<AttachmentState>([
  "reserved",
  "uploading",
  "quarantined",
  "clean",
  "claimed",
]);

export const transitionAttachment = (
  record: StoredAttachment,
  next: AttachmentState,
): void => {
  if (!allowedTransitions[record.state].includes(next)) {
    throw new AttachmentQuarantineError(
      "Attachment state changed before this operation completed.",
      "ATTACHMENT_STATE_CONFLICT",
      409,
    );
  }
  record.state = next;
};

export const attachmentSnapshot = (
  record: StoredAttachment,
): AttachmentSnapshot => ({
  contentLength: record.contentLength,
  createdAt: new Date(record.createdAt).toISOString(),
  ...(record.detectedMimeType
    ? { detectedMimeType: record.detectedMimeType }
    : {}),
  expiresAt: new Date(record.expiresAt).toISOString(),
  fileName: record.fileName,
  id: record.id,
  state: record.state,
});

export const authorizeAttachment = (
  record: StoredAttachment | undefined,
  key: Buffer,
  scope: AttachmentScope,
): StoredAttachment => {
  const expected = deriveScopeBindings(key, scope);
  if (!record || !bindingsEqual(record.bindings.access, expected.access)) {
    throw notFoundError();
  }
  return record;
};

export const assertUnexpired = (
  record: StoredAttachment,
  now: number,
): void => {
  if (record.expiresAt <= now) {
    throw new AttachmentQuarantineError(
      "Attachment reservation expired.",
      "ATTACHMENT_EXPIRED",
      410,
    );
  }
};

export const assertReservationQuota = (
  records: Iterable<StoredAttachment>,
  bindings: ScopeBindings,
  contentLength: number,
  quotas: AttachmentQuotas,
): void => {
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > quotas.maxFileBytes
  ) {
    throw new AttachmentQuarantineError(
      "Attachment exceeds the per-file limit.",
      "ATTACHMENT_FILE_QUOTA_EXCEEDED",
      413,
    );
  }
  let draftBytes = 0;
  let draftCount = 0;
  let globalBytes = 0;
  let totalRecords = 0;
  let sessionBytes = 0;
  for (const record of records) {
    totalRecords += 1;
    if (!quotaStates.has(record.state)) {
      continue;
    }
    globalBytes += record.contentLength;
    if (bindingsEqual(record.bindings.session, bindings.session)) {
      sessionBytes += record.contentLength;
    }
    if (bindingsEqual(record.bindings.draft, bindings.draft)) {
      draftBytes += record.contentLength;
      draftCount += 1;
    }
  }
  if (
    totalRecords >= quotas.maxGlobalRecords ||
    globalBytes > quotas.maxGlobalBytes - contentLength
  ) {
    throw new AttachmentQuarantineError(
      "Attachment service capacity is temporarily exhausted.",
      "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED",
      503,
    );
  }
  if (draftCount >= quotas.maxFilesPerDraft) {
    throw new AttachmentQuarantineError(
      "Attachment count limit reached.",
      "ATTACHMENT_COUNT_QUOTA_EXCEEDED",
      413,
    );
  }
  if (draftBytes > quotas.maxAggregateBytesPerDraft - contentLength) {
    throw new AttachmentQuarantineError(
      "Draft attachment size limit reached.",
      "ATTACHMENT_DRAFT_QUOTA_EXCEEDED",
      413,
    );
  }
  if (sessionBytes > quotas.maxBytesPerSession - contentLength) {
    throw new AttachmentQuarantineError(
      "Session attachment size limit reached.",
      "ATTACHMENT_SESSION_QUOTA_EXCEEDED",
      413,
    );
  }
};
