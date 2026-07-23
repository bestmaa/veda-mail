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
      preview: "",
      receivedAt: "2026-07-23T10:00:00.000Z",
      size: 0,
      subject: null,
      threadId: "thread-null-headers",
      to: null,
    });

    expect(mapMessageSummary(nullableHeaders)).toMatchObject({
      from: [],
      subject: "(No subject)",
      to: [],
    });
  });

  it("sanitizes active and tracking HTML", () => {
    const detail = mapMessageDetail(email);
    expect(detail.htmlBody).toContain("<strong>team</strong>");
    expect(detail.htmlBody).not.toContain("<script");
    expect(detail.htmlBody).not.toContain("<img");
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
