import "server-only";

import type { Attachment } from "@/domain/mail/mail";
import {
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import type { MessageId } from "@/domain/shared/brand";
import {
  attachmentIdsEqual,
  createOpaqueReceivedAttachmentId,
} from "@/infrastructure/providers/attachment-identity";
import {
  collectImapAttachmentParts,
  type ImapAttachmentPart,
} from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import type { MessageStructureObject } from "imapflow";

export interface ImapReceivedAttachment {
  readonly metadata: Attachment;
  readonly part: string;
}

interface BindImapAttachmentsInput {
  readonly accountScope: string;
  readonly messageId: MessageId;
  readonly structure: MessageStructureObject;
  readonly uidValidity: bigint;
}

const assertUidValidity = (value: bigint): string => {
  if (value <= BigInt(0)) {
    throw new Error("IMAP UIDVALIDITY must be positive.");
  }
  return value.toString();
};

export const imapAttachmentAccountScope = (username: string): string =>
  username.trim().toLowerCase();

const bindAttachment = (
  input: BindImapAttachmentsInput,
  attachment: ImapAttachmentPart,
  ordinal: number,
  uidValidity: string,
): ImapReceivedAttachment => {
  const name = sanitizeReceivedAttachmentName(attachment.filename);
  const mimeType = normalizeReceivedAttachmentMimeType(
    attachment.contentType,
  );
  const size = attachment.size ?? 0;
  return {
    metadata: {
      id: createOpaqueReceivedAttachmentId("imap-smtp", [
        input.accountScope,
        input.messageId,
        uidValidity,
        ordinal,
        attachment.part,
        attachment.disposition,
        attachment.contentId,
        attachment.transferEncoding,
        name,
        mimeType,
        size,
      ]),
      mimeType,
      name,
      size,
    },
    part: attachment.part,
  };
};

export const bindImapReceivedAttachments = (
  input: BindImapAttachmentsInput,
): readonly ImapReceivedAttachment[] => {
  const uidValidity = assertUidValidity(input.uidValidity);
  return collectImapAttachmentParts(input.structure).map(
    (attachment, ordinal) =>
      bindAttachment(input, attachment, ordinal, uidValidity),
  );
};

export const findImapReceivedAttachment = (
  input: BindImapAttachmentsInput,
  attachmentId: string,
): ImapReceivedAttachment | null =>
  bindImapReceivedAttachments(input).find((attachment) =>
    attachmentIdsEqual(attachment.metadata.id, attachmentId),
  ) ?? null;
