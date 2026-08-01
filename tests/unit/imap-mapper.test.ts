import type { ParsedMail } from "mailparser";
import { describe, expect, it } from "vitest";

import type { MessageSummary } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  mapImapSummary,
  mapParsedMessage,
} from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";

const summary: MessageSummary = {
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  id: id.message("message-1"),
  isStarred: false,
  isUnread: true,
  labelIds: [],
  mailboxIds: [id.mailbox("inbox")],
  preview: "Preview",
  receivedAt: "2026-07-29T00:00:00.000Z",
  size: 128,
  subject: "Security fixture",
  threadId: id.thread("thread-1"),
  to: [{ email: "member@example.com", name: null }],
};
const identity = {
  config: {
    imapHost: "imap.example.com",
    imapPort: "993",
    username: "member@example.com",
  },
  uidValidity: BigInt(123),
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

  it("uses parser-backed plain text for the generated HTML fallback", () => {
    const detail = mapParsedMessage(summary, {
      attachments: [],
      cc: undefined,
      html: false,
      replyTo: undefined,
      text: undefined,
      textAsHtml:
        "<script>SECRET_SCRIPT()</script>" +
        "<style>.SECRET_STYLE{display:none}</style>" +
        "<h2>Update &amp; status</h2><p>First<br>Second</p>",
    } as unknown as ParsedMail);

    expect(detail.textBody).toBe("Update & status\nFirst\nSecond");
    expect(detail.textBody).not.toMatch(/SECRET_SCRIPT|SECRET_STYLE|<[^>]+>/i);
  });

  it("uses only provider-verified attachment metadata", () => {
    const verified = {
      contentId: null,
      metadata: {
        disposition: "attachment" as const,
        id: id.attachment("opaque-verified-id"),
        mimeType: "application/pdf",
        name: "verified.pdf",
        size: null,
      },
      part: "2",
    };
    const detail = mapParsedMessage(
      summary,
      {
        attachments: [
          {
            cid: "attacker-controlled-cid",
            contentType: "text/html",
            filename: "untrusted.html",
            size: 999,
          },
        ],
        html: false,
        text: "",
      } as unknown as ParsedMail,
      [verified],
    );

    expect(detail.attachments).toEqual([verified.metadata]);
    expect(JSON.stringify(detail.attachments)).not.toContain(
      "attacker-controlled-cid",
    );
  });

  it("keeps an unreferenced inline part visible as an attachment fallback", () => {
    const unreferenced = {
      contentId: "unreferenced@example.test",
      metadata: {
        disposition: "inline" as const,
        id: id.attachment("opaque-unreferenced-id"),
        mimeType: "image/png",
        name: "unreferenced.png",
        size: null,
      },
      part: "2",
    };
    const detail = mapParsedMessage(
      summary,
      {
        attachments: [],
        html: "<p>No inline image reference</p>",
        text: "No inline image reference",
      } as unknown as ParsedMail,
      [unreferenced],
    );

    expect(detail.attachments).toEqual([
      { ...unreferenced.metadata, disposition: "attachment" },
    ]);
  });

  it("derives the summary paperclip from authoritative attachment parts", () => {
    const named = mapImapSummary("INBOX", {
      bodyStructure: {
        parameters: { name: "report.pdf" },
        part: "1",
        type: "application/pdf",
      },
      seq: 1,
      uid: 1,
    }, identity);
    const cidOnlyInline = mapImapSummary("INBOX", {
      bodyStructure: {
        id: "<logo@example.test>",
        part: "1",
        type: "image/png",
      },
      seq: 2,
      uid: 2,
    }, identity);

    expect(named.hasAttachment).toBe(true);
    expect(cidOnlyInline.hasAttachment).toBe(false);
  });
});
