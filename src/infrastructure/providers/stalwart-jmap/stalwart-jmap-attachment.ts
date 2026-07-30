import "server-only";

import type { Attachment } from "@/domain/mail/mail";
import { isSupportedReceivedInlineImageMimeType } from "@/domain/mail/inline-image";
import {
  normalizeContentId,
  normalizeReceivedAttachmentDisposition,
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import {
  attachmentIdsEqual,
  createOpaqueReceivedAttachmentId,
} from "@/infrastructure/providers/attachment-identity";
import { jmapAttachmentCandidates } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment-candidates";
import {
  jmapBodyPartBindingIdentity,
  jmapBodyPartProviderPartId,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-part-identity";
import type {
  JmapBodyPart,
  JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface JmapReceivedAttachment {
  readonly contentId: string | null;
  readonly metadata: Attachment;
}

interface JmapReceivedAttachmentSecret {
  readonly inlineRenderingAllowed: boolean;
  readonly providerPartIdentity: string;
  readonly providerBlobId: string;
}

const attachmentSecrets = new WeakMap<
  JmapReceivedAttachment,
  JmapReceivedAttachmentSecret
>();

const validBlobId = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
};

const normalizedSize = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
};

const normalizedContentId = (value: unknown): string | null =>
  typeof value === "string" ? normalizeContentId(value) : null;

const normalizedMediaType = (part: JmapBodyPart): string =>
  normalizeReceivedAttachmentMimeType(part.type);

const bindAttachment = (
  accountId: string,
  email: Pick<JmapEmail, "id">,
  attachment: JmapBodyPart,
  fallbackDisposition: Attachment["disposition"],
  forceAttachment: boolean,
  index: number,
): JmapReceivedAttachment | null => {
  const size = normalizedSize(attachment.size);
  if (!validBlobId(attachment.blobId) || size === undefined) return null;
  const name = sanitizeReceivedAttachmentName(
    attachment.name ?? `Attachment ${index + 1}`,
  );
  const mimeType = normalizedMediaType(attachment);
  const contentId = normalizedContentId(attachment.cid);
  const normalizedDisposition = normalizeReceivedAttachmentDisposition(
    attachment.disposition,
    contentId && isSupportedReceivedInlineImageMimeType(mimeType)
      ? "inline"
      : fallbackDisposition,
  );
  const disposition = forceAttachment ? "attachment" : normalizedDisposition;
  const providerPartId = jmapBodyPartProviderPartId(attachment);
  const bound = Object.freeze({
    contentId,
    metadata: Object.freeze({
      disposition,
      id: createOpaqueReceivedAttachmentId("stalwart-jmap", [
        accountId,
        email.id,
        index,
        attachment.blobId,
        providerPartId,
        name,
        mimeType,
        size,
        contentId,
        disposition,
      ]),
      mimeType,
      name,
      size,
    }),
  });
  attachmentSecrets.set(
    bound,
    Object.freeze({
      inlineRenderingAllowed: !forceAttachment,
      providerPartIdentity: jmapBodyPartBindingIdentity(attachment),
      providerBlobId: attachment.blobId,
    }),
  );
  return bound;
};

export const bindJmapReceivedAttachments = (
  accountId: string,
  email: Pick<JmapEmail, "attachments" | "htmlBody" | "id">,
): readonly JmapReceivedAttachment[] =>
  jmapAttachmentCandidates(email).flatMap(
    ({ attachment, fallbackDisposition, forceAttachment }, index) => {
      const bound = bindAttachment(
        accountId,
        email,
        attachment,
        fallbackDisposition,
        forceAttachment,
        index,
      );
      return bound ? [bound] : [];
    },
  );

export const readJmapReceivedAttachmentProviderBlobId = (
  attachment: JmapReceivedAttachment,
): string | null => attachmentSecrets.get(attachment)?.providerBlobId ?? null;

export const readJmapReceivedAttachmentPartIdentity = (
  attachment: JmapReceivedAttachment,
): string | null =>
  attachmentSecrets.get(attachment)?.providerPartIdentity ?? null;

export const isJmapReceivedAttachmentInlineRenderingAllowed = (
  attachment: JmapReceivedAttachment,
): boolean =>
  attachmentSecrets.get(attachment)?.inlineRenderingAllowed === true;

export const findJmapReceivedAttachment = (
  accountId: string,
  email: Pick<JmapEmail, "attachments" | "htmlBody" | "id">,
  attachmentId: string,
): JmapReceivedAttachment | null =>
  bindJmapReceivedAttachments(accountId, email).find((attachment) =>
    attachmentIdsEqual(attachment.metadata.id, attachmentId),
  ) ?? null;
