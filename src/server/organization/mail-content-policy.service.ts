import "server-only";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { Attachment, OutgoingAttachment } from "@/domain/mail/mail";
import type { MailContentPolicy } from "@/domain/installation/mail-content-policy";
import { mailContentPolicyStore } from "@/server/organization/mail-content-policy.store";
import { sanitizeAttachmentFileName } from "@/server/attachments/attachment-security";
import { ApiError } from "@/transport/http/api-error";

interface AttachmentMetadata {
  readonly mimeType?: string;
  readonly name: string;
  readonly size: number;
}

const extensionOf = (name: string): string => {
  const fileName = sanitizeAttachmentFileName(name).toLowerCase();
  const index = fileName.lastIndexOf(".");
  return index > 0 && index < fileName.length - 1 ? fileName.slice(index + 1) : "";
};

const blocked = (message: string, code: string): never => {
  throw new ApiError(message, code, 422);
};

export const assertAttachmentFilePolicy = (
  policy: MailContentPolicy,
  attachment: AttachmentMetadata,
): void => {
  if (attachment.size > policy.maxAttachmentBytes) {
    blocked("This file exceeds the organization attachment limit.", "ORGANIZATION_ATTACHMENT_TOO_LARGE");
  }
  const extension = extensionOf(attachment.name);
  if (policy.blockedExtensions.includes(extension)) {
    blocked("This file type is blocked by organization policy.", "ORGANIZATION_FILE_TYPE_BLOCKED");
  }
  if (policy.allowedExtensions.length > 0 && !policy.allowedExtensions.includes(extension)) {
    blocked("This file type is not allowed by organization policy.", "ORGANIZATION_FILE_TYPE_NOT_ALLOWED");
  }
  if (!attachment.mimeType) return;
  const mimeType = attachment.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (policy.blockedMimeTypes.includes(mimeType)) {
    blocked("This detected file type is blocked by organization policy.", "ORGANIZATION_MIME_TYPE_BLOCKED");
  }
  if (policy.allowedMimeTypes.length > 0 && !policy.allowedMimeTypes.includes(mimeType)) {
    blocked("This detected file type is not allowed by organization policy.", "ORGANIZATION_MIME_TYPE_NOT_ALLOWED");
  }
};

const utf8Bytes = (value: string): number => Buffer.byteLength(value, "utf8");
const contentBytes = (content: DraftContent): number => [
  content.subject,
  content.body,
  content.htmlBody ?? "",
  ...content.to.flatMap(({ email, name }) => [email, name ?? ""]),
  ...content.cc.flatMap(({ email, name }) => [email, name ?? ""]),
  ...content.bcc.flatMap(({ email, name }) => [email, name ?? ""]),
].reduce((total, value) => total + utf8Bytes(value), 0);

export const assertOutgoingMailPolicy = (
  policy: MailContentPolicy,
  content: DraftContent,
  attachments: readonly AttachmentMetadata[],
): void => {
  if (attachments.length > policy.maxAttachmentsPerMessage) {
    blocked("This message has too many attachments for organization policy.", "ORGANIZATION_ATTACHMENT_COUNT_EXCEEDED");
  }
  for (const attachment of attachments) assertAttachmentFilePolicy(policy, attachment);
  const total = contentBytes(content) + attachments.reduce((sum, item) => sum + item.size, 0);
  if (total > policy.maxMessageBytes) {
    blocked("This message exceeds the organization message size limit.", "ORGANIZATION_MESSAGE_TOO_LARGE");
  }
};

export const getMailContentPolicy = (): Promise<MailContentPolicy> =>
  mailContentPolicyStore.get();

export const asAttachmentMetadata = (
  attachment: OutgoingAttachment,
): AttachmentMetadata => ({
  mimeType: attachment.mimeType,
  name: attachment.name,
  size: attachment.size,
});

export const asSavedAttachmentMetadata = (
  attachment: Attachment,
): AttachmentMetadata => {
  if (!Number.isSafeInteger(attachment.size) || (attachment.size ?? -1) < 0) {
    throw new ApiError(
      "A saved attachment size could not be verified against organization policy.",
      "ORGANIZATION_ATTACHMENT_METADATA_UNAVAILABLE",
      409,
    );
  }
  return {
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.size as number,
  };
};

export const assertSavedDraftMailPolicy = (
  policy: MailContentPolicy,
  draft: DraftDetail,
): void => assertOutgoingMailPolicy(
  policy,
  draft.content,
  (draft.attachments ?? []).map(asSavedAttachmentMetadata),
);
