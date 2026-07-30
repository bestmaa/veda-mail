import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type { MessageAttachmentMetadata } from "@/domain/mail/mail";

const invalidMetadata = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "provider_failure",
    "The provider returned invalid attachment metadata.",
  );

export const assertAttachmentArchiveMetadata = (
  attachments: readonly MessageAttachmentMetadata[],
): void => {
  const attachmentIds = new Set<string>();
  for (const attachment of attachments) {
    if (
      attachment.disposition !== "attachment" ||
      typeof attachment.id !== "string" ||
      attachment.id.length === 0 ||
      attachmentIds.has(attachment.id) ||
      typeof attachment.mimeType !== "string" ||
      attachment.mimeType.length === 0 ||
      typeof attachment.name !== "string" ||
      attachment.name.length === 0
    ) {
      throw invalidMetadata();
    }
    attachmentIds.add(attachment.id);
  }
};
