import type { ParsedMail } from "mailparser";
import { describe, expect, it } from "vitest";

import type { MessageSummary } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { mapParsedMessage } from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";

const summary: MessageSummary = {
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  id: id.message("message-1"),
  isStarred: false,
  isUnread: true,
  mailboxIds: [id.mailbox("inbox")],
  preview: "Preview",
  receivedAt: "2026-07-29T00:00:00.000Z",
  size: 128,
  subject: "Security fixture",
  threadId: id.thread("thread-1"),
  to: [{ email: "member@example.com", name: null }],
};

describe("IMAP MIME mapping", () => {
  it("applies the shared active-content policy to parsed HTML", () => {
    const detail = mapParsedMessage(summary, {
      attachments: [],
      cc: undefined,
      html:
        '<p style="color:red">Safe</p>' +
        '<script>alert(1)</script>' +
        '<img src="https://tracker.example/pixel">' +
        '<a href="https://example.com" target="_self">Open</a>',
      replyTo: undefined,
      text: "Safe Open",
    } as unknown as ParsedMail);

    expect(detail.htmlBody).toBe(
      '<p>Safe</p><a href="https://example.com" rel="noopener noreferrer" target="_blank">Open</a>',
    );
    expect(detail.htmlBody).not.toMatch(/script|img|style=/i);
  });
});
