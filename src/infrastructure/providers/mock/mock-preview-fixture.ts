import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";

const encoder = new TextEncoder();

export const mockPreviewMessageId = id.message("msg-preview-security-fixture");
export const mockPreviewAttachment = {
  bytes: encoder.encode(
    [
      "This is inert plain text.",
      '<img src="https://preview-leak.invalid/pixel">',
      '<script>window.open("https://preview-leak.invalid/popup")</script>',
      "",
    ].join("\n"),
  ),
  id: id.attachment("attachment-preview-plain-text"),
  mimeType: "text/plain",
  name: "security-notes.txt",
} as const;

export const createMockPreviewMessage = (): MessageDetail => ({
  attachments: [
    {
      id: mockPreviewAttachment.id,
      mimeType: mockPreviewAttachment.mimeType,
      name: mockPreviewAttachment.name,
      size: mockPreviewAttachment.bytes.byteLength,
    },
  ],
  cc: [],
  from: [{ email: "security@example.com", name: "Security Review" }],
  hasAttachment: true,
  htmlBody: null,
  id: mockPreviewMessageId,
  isStarred: false,
  isUnread: false,
  mailboxIds: [id.mailbox("mock-inbox")],
  preview: "A hostile-looking string must remain inert plain text.",
  receivedAt: "2026-07-23T03:55:00.000Z",
  replyTo: [],
  size: 8_192,
  subject: "Attachment preview security fixture",
  textBody: "Open the text attachment to verify the isolated preview.",
  threadId: id.thread("thread-preview-security-fixture"),
  to: [{ email: "member@example.com", name: "Sample Member" }],
});
