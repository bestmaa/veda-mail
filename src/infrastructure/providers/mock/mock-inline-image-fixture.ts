import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import type { MailboxId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";

const inlineImageBytes = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
  1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68,
  65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0,
  0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

export const mockInlineImageAttachment = {
  id: id.attachment("attachment-inline-logo"),
  messageId: id.message("msg-inline-image"),
  mimeType: "image/png",
  name: "inline-logo.png",
} as const;

export const createMockInlineImageBytes = (): Uint8Array =>
  inlineImageBytes.slice();

export const createMockInlineImageMessage = (
  inbox: MailboxId,
): MessageDetail => ({
  attachments: [
    {
      disposition: "inline",
      id: mockInlineImageAttachment.id,
      mimeType: mockInlineImageAttachment.mimeType,
      name: mockInlineImageAttachment.name,
      size: inlineImageBytes.byteLength,
    },
  ],
  cc: [],
  from: [{ email: "design@example.com", name: "Design Team" }],
  hasAttachment: false,
  htmlBody:
    "<p>This logo is embedded in the message.</p>" +
    `<img data-veda-inline-image="${mockInlineImageAttachment.id}" ` +
    'alt="Embedded Veda logo">',
  id: mockInlineImageAttachment.messageId,
  isStarred: false,
  isUnread: true,
  mailboxIds: [inbox],
  preview: "This logo is embedded in the message.",
  receivedAt: "2026-07-23T05:20:00.000Z",
  replyTo: [],
  size: 512,
  subject: "Secure embedded image example",
  textBody: "This logo is embedded in the message.",
  threadId: id.thread("thread-inline-image"),
  to: [{ email: "member@example.com", name: "Sample Member" }],
});
