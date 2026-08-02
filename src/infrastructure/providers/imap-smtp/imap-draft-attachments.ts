import "server-only";

import { createHash } from "node:crypto";
import type { ParsedMail } from "mailparser";

import type { Attachment, OutgoingAttachment } from "@/domain/mail/mail";
import type { DraftDetail, DraftSaveInput } from "@/domain/mail/draft";
import { DraftConflictError, DraftContentTruncatedError } from "@/domain/mail/draft-errors";
import { assertDraftRevision, canonicalDraftComposeId } from "@/domain/mail/draft-validation";
import { id, type ProviderDraftId } from "@/domain/shared/brand";
import {
  attachmentIdsEqual,
  createOpaqueReceivedAttachmentId,
} from "@/infrastructure/providers/attachment-identity";
import {
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import {
  normalizeAttachmentFilename,
  normalizeAttachmentMimeType,
} from "@/infrastructure/providers/imap-smtp/mime-attachment-headers";

export interface ImapDraftAttachmentRecord {
  readonly detail: Attachment;
  readonly outgoing: OutgoingAttachment;
}

export const parseImapDraftAttachments = (input: {
  readonly accountScope: string;
  readonly mail: ParsedMail;
  readonly providerDraftId: ProviderDraftId;
}): readonly ImapDraftAttachmentRecord[] => input.mail.attachments.map(
  (attachment, index) => {
    const content = Buffer.from(attachment.content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const name = sanitizeReceivedAttachmentName(attachment.filename);
    const mimeType = normalizeReceivedAttachmentMimeType(attachment.contentType);
    const attachmentId = createOpaqueReceivedAttachmentId("imap-smtp", [
      "draft",
      input.accountScope,
      input.providerDraftId,
      index,
      name,
      mimeType,
      content.byteLength,
      sha256,
    ]);
    return {
      detail: {
        disposition: "attachment",
        id: attachmentId,
        mimeType,
        name,
        size: content.byteLength,
      },
      outgoing: {
        content,
        id: id.attachmentUpload(`imap-draft-${index}-${sha256}`),
        mimeType,
        name,
        sha256,
        size: content.byteLength,
      },
    };
  },
);

export const imapDraftAttachmentsAreCanonical = (
  mail: ParsedMail,
): boolean => mail.attachments.length <= 10 &&
  mail.attachments.reduce(
    (total, attachment) => total + attachment.content.byteLength,
    0,
  ) <= 18 * 1024 * 1024 && mail.attachments.every(
  (attachment) =>
    attachment.contentDisposition?.trim().toLowerCase() === "attachment" &&
    !attachment.cid && !attachment.related &&
    attachment.content.byteLength <= 18 * 1024 * 1024,
);

export const imapDraftAttachmentFingerprint = (
  attachments: readonly OutgoingAttachment[],
): string => createHash("sha256").update(JSON.stringify(attachments.map((item) => ({
  mimeType: normalizeAttachmentMimeType(item.mimeType),
  name: normalizeAttachmentFilename(item.name),
  sha256: item.sha256,
  size: item.size,
})))).digest("hex");

type LoadedImapDraft = {
  readonly attachments: readonly ImapDraftAttachmentRecord[];
  readonly detail: DraftDetail;
  readonly uid: number;
};

export const resolveImapDraftSaveAttachments = (
  existing: LoadedImapDraft,
  input: Extract<DraftSaveInput, { readonly providerDraftId: ProviderDraftId }>,
): readonly OutgoingAttachment[] => {
  const retained = (input.retainedAttachmentIds ?? []).map((attachmentId) => {
    const match = existing.attachments.find(({ detail }) =>
      attachmentIdsEqual(detail.id, attachmentId));
    if (!match) throw new DraftConflictError();
    return match.outgoing;
  });
  if (retained.length + (input.attachments?.length ?? 0) > 10) {
    throw new DraftConflictError();
  }
  return [...retained, ...(input.attachments ?? [])];
};

export const assertImapDraftReplaceable = (
  existing: LoadedImapDraft,
  input: Extract<DraftSaveInput, { readonly providerDraftId: ProviderDraftId }>,
  matches: readonly number[],
): void => {
  if (existing.detail.composeId !== canonicalDraftComposeId(input.composeId) ||
    existing.detail.revision !== assertDraftRevision(input.expectedRevision) ||
    matches.length !== 1 || matches[0] !== existing.uid) {
    throw new DraftConflictError();
  }
  if (existing.detail.hasTruncatedContent) throw new DraftContentTruncatedError();
};

export const sameImapDraftAttachmentSelection = (
  existing: LoadedImapDraft,
  input: DraftSaveInput,
): boolean => imapDraftAttachmentFingerprint(
  existing.attachments.map(({ outgoing }) => outgoing),
) === imapDraftAttachmentFingerprint(input.attachments ?? []);
