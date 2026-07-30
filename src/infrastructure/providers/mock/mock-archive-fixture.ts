import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import type { AttachmentId } from "@/domain/shared/brand";
import { id } from "@/domain/shared/brand";

const encoder = new TextEncoder();

export const mockArchiveMessageId = id.message("msg-archive-fixtures");
export const mockArchiveFailureMessageId = id.message(
  "msg-archive-post-preflight-failure",
);

export const mockArchiveAttachments = [
  {
    bytes: encoder.encode("first deterministic attachment\n"),
    id: id.attachment("attachment-archive-one"),
    mimeType: "text/plain",
    name: "../../report.txt",
  },
  {
    bytes: Uint8Array.of(0, 255, 1, 254, 2, 253),
    id: id.attachment("attachment-archive-two"),
    mimeType: "application/octet-stream",
    name: "../../REPORT.txt",
  },
  {
    bytes: new Uint8Array(),
    id: id.attachment("attachment-archive-three"),
    mimeType: "text/plain",
    name: "नमस्ते.txt",
  },
] as const;

export const createMockArchiveContents = (): Map<
  AttachmentId,
  Uint8Array
> =>
  new Map(
    mockArchiveAttachments.map((attachment) => [
      attachment.id,
      attachment.bytes.slice(),
    ]),
  );

export const createMockArchiveMessage = (): MessageDetail => ({
  attachments: mockArchiveAttachments.map((attachment) => ({
    disposition: "attachment",
    id: attachment.id,
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.bytes.byteLength,
  })),
  cc: [],
  from: [{ email: "qa@example.com", name: "Quality Assurance" }],
  hasAttachment: true,
  htmlBody: null,
  id: mockArchiveMessageId,
  isStarred: false,
  isUnread: false,
  mailboxIds: [id.mailbox("mock-inbox")],
  preview: "Three deterministic files exercise secure ZIP download.",
  receivedAt: "2026-07-23T03:50:00.000Z",
  replyTo: [],
  size: 8_192,
  subject: "Archive download security fixtures",
  textBody: "These files verify safe, byte-identical archive downloads.",
  threadId: id.thread("thread-archive-fixtures"),
  to: [{ email: "member@example.com", name: "Sample Member" }],
});

export const createMockArchiveFailureMessage = (): MessageDetail => {
  const source = createMockArchiveMessage();
  return {
    ...source,
    attachments: source.attachments.slice(0, 2),
    id: mockArchiveFailureMessageId,
    preview: "Metadata preflight succeeds before a simulated provider failure.",
    subject: "Archive provider failure recovery fixture",
    textBody:
      "This test-only message verifies honest naming after a late failure.",
    threadId: id.thread("thread-archive-post-preflight-failure"),
  };
};
