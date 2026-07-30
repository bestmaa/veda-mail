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
  isSupportedImapInlineRasterType,
} from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import type { MessageStructureObject } from "imapflow";

export interface ImapReceivedAttachment {
  readonly contentId: string | null;
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

export const imapAttachmentAccountScope = (
  config: Pick<ImapSmtpMemberConfig, "imapHost" | "imapPort" | "username">,
): string =>
  JSON.stringify([
    config.imapHost.trim().toLowerCase(),
    config.imapPort.trim(),
    config.username,
  ]);

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
  return {
    contentId: attachment.contentId,
    metadata: {
      disposition: attachment.disposition,
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
        attachment.size,
      ]),
      mimeType,
      name,
      size: null,
    },
    part: attachment.part,
  };
};

export const bindImapReceivedAttachments = (
  input: BindImapAttachmentsInput,
): readonly ImapReceivedAttachment[] => {
  const uidValidity = assertUidValidity(input.uidValidity);
  const attachments = collectImapAttachmentParts(input.structure);
  const inlineContentIdCounts = new Map<string, number>();
  for (const attachment of attachments) {
    if (
      attachment.contentId &&
      isSupportedImapInlineRasterType(attachment.contentType)
    ) {
      inlineContentIdCounts.set(
        attachment.contentId,
        (inlineContentIdCounts.get(attachment.contentId) ?? 0) + 1,
      );
    }
  }
  return attachments.map((attachment, ordinal) => {
    const effectiveAttachment =
      attachment.disposition === "inline" &&
      attachment.contentId &&
      inlineContentIdCounts.get(attachment.contentId) !== 1
        ? { ...attachment, disposition: "attachment" as const }
        : attachment;
    return bindAttachment(input, effectiveAttachment, ordinal, uidValidity);
  });
};

export const findImapReceivedAttachment = (
  input: BindImapAttachmentsInput,
  attachmentId: string,
): ImapReceivedAttachment | null =>
  bindImapReceivedAttachments(input).find((attachment) =>
    attachmentIdsEqual(attachment.metadata.id, attachmentId),
  ) ?? null;
