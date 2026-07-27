import { describe, expect, it } from "vitest";

import {
  mapMailbox,
  mapMessageDetail,
  mapMessageSummary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import type { JmapEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const email: JmapEmail = {
  bodyValues: {
    html: {
      value:
        '<p>Hello <strong>team</strong></p><script>alert("x")</script><img src="https://tracker.invalid/pixel">',
    },
    text: { value: "Hello team" },
  },
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  htmlBody: [{ partId: "html", type: "text/html" }],
  id: "email-1",
  keywords: { $flagged: true },
  mailboxIds: { inbox: true },
  preview: "Hello team",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 120,
  subject: "Mapper test",
  textBody: [{ partId: "text", type: "text/plain" }],
  threadId: "thread-1",
  to: [{ email: "recipient@example.com" }],
};

describe("Stalwart JMAP mapper", () => {
  it("normalizes provider-specific message data", () => {
    const summary = mapMessageSummary(email);
    expect(summary.isStarred).toBe(true);
    expect(summary.isUnread).toBe(true);
    expect(summary.mailboxIds).toEqual(["inbox"]);
  });

  it("accepts RFC-valid nullable message headers", () => {
    const nullableHeaders = jmapEmailSchema.parse({
      bcc: null,
      cc: null,
      from: null,
      hasAttachment: false,
      id: "email-null-headers",
      keywords: {},
      mailboxIds: { inbox: true },
      receivedAt: "2026-07-23T10:00:00.000Z",
      size: 0,
      subject: null,
      threadId: "thread-null-headers",
      to: null,
    });

    expect(mapMessageSummary(nullableHeaders)).toMatchObject({
      from: [],
      preview: "",
      subject: "(No subject)",
      to: [],
    });
  });

  it("accepts nullable multipart body identifiers from Stalwart", () => {
    const multipartEmail = jmapEmailSchema.parse({
      attachments: [
        {
          blobId: null,
          name: null,
          partId: null,
          size: null,
          type: "multipart/mixed",
        },
      ],
      hasAttachment: true,
      id: "email-multipart",
      keywords: {},
      mailboxIds: { inbox: true },
      receivedAt: "2026-07-23T10:00:00.000Z",
      size: 0,
      subject: null,
      threadId: "thread-multipart",
    });

    expect(mapMessageDetail(multipartEmail).attachments).toEqual([
      {
        id: "attachment-0",
        mimeType: "multipart/mixed",
        name: "Attachment 1",
        size: 0,
      },
    ]);
  });

  it("sanitizes active and tracking HTML", () => {
    const detail = mapMessageDetail(email);
    expect(detail.htmlBody).toContain("<strong>team</strong>");
    expect(detail.htmlBody).not.toContain("<script");
    expect(detail.htmlBody).not.toContain("<img");
  });

  it("routes a plain-text htmlBody fallback to textBody", () => {
    const plainFallback: JmapEmail = {
      ...email,
      bodyValues: {
        plain: {
          value: "<strong>This is plain text</strong>\nSecond line",
        },
      },
      htmlBody: [{ partId: "plain", type: "text/plain" }],
      textBody: [{ partId: "plain", type: "text/plain" }],
    };

    const detail = mapMessageDetail(plainFallback);

    expect(detail.htmlBody).toBeNull();
    expect(detail.textBody).toBe(
      "<strong>This is plain text</strong>\nSecond line",
    );
  });

  it("preserves sequential text parts and ignores duplicate part IDs", () => {
    const multipartText: JmapEmail = {
      ...email,
      bodyValues: {
        body: { value: "Body" },
        footer: { value: "Footer" },
        header: { value: "Header" },
      },
      htmlBody: undefined,
      textBody: [
        { partId: "missing", type: "text/plain" },
        { partId: "header", type: "text/plain" },
        { partId: "body", type: "text/plain" },
        { partId: "body", type: "text/plain" },
        { partId: "footer", type: "text/plain" },
      ],
    };

    expect(mapMessageDetail(multipartText).textBody).toBe(
      "Header\nBody\nFooter",
    );
  });

  it("escapes plain segments in a mixed HTML body", () => {
    const mixedBody: JmapEmail = {
      ...email,
      bodyValues: {
        footer: {
          value: "<em>literal footer</em>\nSecond line",
        },
        main: {
          value:
            "<p>Main <strong>message</strong></p><script>attack()</script>",
        },
        tail: { value: "<p>Tail</p>" },
      },
      htmlBody: [
        { partId: "main", type: "text/html" },
        { partId: "footer", type: "text/plain" },
        { partId: "tail", type: "text/html" },
      ],
      textBody: undefined,
    };

    const detail = mapMessageDetail(mixedBody);
    const html = detail.htmlBody ?? "";

    expect(html).not.toContain("<script");
    expect(html).toContain(
      "<pre>&lt;em&gt;literal footer&lt;/em&gt;\nSecond line</pre>",
    );
    expect(html.indexOf("Main")).toBeLessThan(html.indexOf("literal footer"));
    expect(html.indexOf("literal footer")).toBeLessThan(html.indexOf("Tail"));
  });

  it("creates readable text for an HTML-only message", () => {
    const htmlOnly: JmapEmail = {
      ...email,
      bodyValues: {
        html: {
          value:
            "<h1>Welcome</h1><p>First &amp; second<br>Next</p><script>attack()</script>",
        },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
      textBody: undefined,
    };

    expect(mapMessageDetail(htmlOnly).textBody).toBe(
      "Welcome\nFirst & second\nNext",
    );
  });

  it("maps the standard JMAP junk role to spam", () => {
    const mailbox = mapMailbox({
      id: "junk",
      name: "Junk",
      role: "junk",
      totalEmails: 3,
      unreadEmails: 1,
    });
    expect(mailbox.role).toBe("spam");
  });
});
