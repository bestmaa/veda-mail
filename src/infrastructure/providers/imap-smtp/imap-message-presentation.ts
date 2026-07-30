import "server-only";

import { simpleParser, type ParsedMail } from "mailparser";

import type {
  MessageAttachmentMetadata,
  MessageDetail,
} from "@/domain/mail/mail";
import { isSupportedImapInlineRasterType } from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import type { ImapReceivedAttachment } from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import { renderedInlineImageAttachmentIds } from "@/infrastructure/providers/sanitize-inline-mail-images";
import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";

interface ImapMessagePresentation {
  readonly attachments: readonly MessageAttachmentMetadata[];
  readonly htmlBody: MessageDetail["htmlBody"];
}

export const parseImapMessagePresentation = (
  source: Parameters<typeof simpleParser>[0],
): Promise<ParsedMail> =>
  simpleParser(source, {
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
  });

export const classifyImapMessagePresentation = (
  parsed: Pick<ParsedMail, "html">,
  receivedAttachments: readonly ImapReceivedAttachment[],
): ImapMessagePresentation => {
  const inlineImages = receivedAttachments.flatMap((attachment) =>
    attachment.contentId &&
    isSupportedImapInlineRasterType(attachment.metadata.mimeType)
      ? [
          {
            attachmentId: attachment.metadata.id,
            contentId: attachment.contentId,
          },
        ]
      : [],
  );
  const htmlBody =
    typeof parsed.html === "string"
      ? sanitizeMailHtml(parsed.html, { inlineImages })
      : null;
  const renderedInlineIds = renderedInlineImageAttachmentIds(htmlBody);
  return {
    attachments: receivedAttachments.map(({ metadata }) =>
      metadata.disposition === "inline" && !renderedInlineIds.has(metadata.id)
        ? { ...metadata, disposition: "attachment" as const }
        : metadata,
    ),
    htmlBody,
  };
};
