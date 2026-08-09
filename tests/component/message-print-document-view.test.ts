import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MessagePrintDocument } from "@/domain/mail/message-print";
import { id } from "@/domain/shared/brand";
import { MessagePrintDocumentView } from "@/presentation/features/mail-workspace/ui/message-print-document.view";

const document: MessagePrintDocument = {
  anchorMessageId: id.message("message-one"),
  messages: [{
    attachments: [{ mimeType: "text/plain", name: "notes.txt", size: 2_048 }],
    cc: [{ email: "copy@example.com", name: null }],
    from: [{ email: "sender@example.com", name: "Sender" }],
    htmlBody: "<p>Sanitized body</p>",
    id: id.message("message-one"),
    receivedAt: "2026-08-09T01:00:00.000Z",
    replyTo: [],
    size: 4_096,
    subject: "Printable subject",
    textBody: "Fallback",
    to: [{ email: "member@example.com", name: null }],
  }],
  scope: "conversation",
  total: 125,
  truncated: true,
};

describe("message print document view", () => {
  it("renders portable headers, sanitized content, attachment metadata, and truncation notice", () => {
    const html = renderToStaticMarkup(createElement(MessagePrintDocumentView, {
      document,
      locale: "en-IN",
      timeZone: "Asia/Kolkata",
    }));

    expect(html).toContain('class="veda-print-root"');
    expect(html).toContain("Printable subject");
    expect(html).toContain("Sender &lt;sender@example.com&gt;");
    expect(html).toContain("notes.txt (2 KB)");
    expect(html).toContain("Sanitized body");
    expect(html).toContain("safe 100-message print limit");
    expect(html).not.toContain("attachmentId");
    expect(html).not.toContain("href=");
  });
});
