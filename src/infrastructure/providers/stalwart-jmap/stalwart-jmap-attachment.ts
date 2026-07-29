import "server-only";

import type { Attachment } from "@/domain/mail/mail";
import {
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import {
  attachmentIdsEqual,
  createOpaqueReceivedAttachmentId,
} from "@/infrastructure/providers/attachment-identity";
import type {
  JmapBodyPart,
  JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface JmapReceivedAttachment {
  readonly metadata: Attachment;
  readonly providerBlobId: string;
}

const validBlobId = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
};

const validSize = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0;

const bindAttachment = (
  accountId: string,
  email: Pick<JmapEmail, "attachments" | "id">,
  attachment: JmapBodyPart,
  index: number,
): JmapReceivedAttachment | null => {
  if (!validBlobId(attachment.blobId) || !validSize(attachment.size)) {
    return null;
  }
  const name = sanitizeReceivedAttachmentName(
    attachment.name ?? `Attachment ${index + 1}`,
  );
  const mimeType = normalizeReceivedAttachmentMimeType(attachment.type);
  return {
    metadata: {
      id: createOpaqueReceivedAttachmentId("stalwart-jmap", [
        accountId,
        email.id,
        index,
        attachment.blobId,
        name,
        mimeType,
        attachment.size,
      ]),
      mimeType,
      name,
      size: attachment.size,
    },
    providerBlobId: attachment.blobId,
  };
};

export const bindJmapReceivedAttachments = (
  accountId: string,
  email: Pick<JmapEmail, "attachments" | "id">,
): readonly JmapReceivedAttachment[] =>
  (email.attachments ?? []).flatMap((attachment, index) => {
    const bound = bindAttachment(accountId, email, attachment, index);
    return bound ? [bound] : [];
  });

export const findJmapReceivedAttachment = (
  accountId: string,
  email: Pick<JmapEmail, "attachments" | "id">,
  attachmentId: string,
): JmapReceivedAttachment | null =>
  bindJmapReceivedAttachments(accountId, email).find((attachment) =>
    attachmentIdsEqual(attachment.metadata.id, attachmentId),
  ) ?? null;
