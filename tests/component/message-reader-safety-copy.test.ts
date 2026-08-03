import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ReaderViewModel } from "@/presentation/features/mail-workspace/mail-workspace.view-model";
import { MessageReaderView } from "@/presentation/features/mail-workspace/ui/message-reader.view";

const reader: ReaderViewModel = {
  attachments: [],
  attachmentPreview: {
    error: null,
    isLoading: false,
    isOpen: false,
    name: "",
    onClose: vi.fn(),
    onRestoreFocus: vi.fn(),
    url: null,
  },
  avatar: "S",
  body: "Message body",
  canArchive: true,
  cc: "",
  conversation: {
    error: null,
    isLoading: false,
    isLoadingMore: false,
    items: [],
    loadMore: null,
    strategyLabel: "Provider thread",
    total: 0,
    truncated: false,
  },
  date: "Aug 2, 2026",
  details: {
    attachments: "None",
    cc: null,
    conversationPosition: null,
    date: "Sun, 2 August 2026 at 10:00 am",
    from: '"Sender" <sender@example.com>',
    messageSize: "120 B",
    replyTo: null,
    to: "member@example.com",
  },
  downloadAll: null,
  error: null,
  from: "Sender",
  fromEmail: "sender@example.com",
  handleSessionFailure: () => false,
  htmlBody: null,
  isLoading: false,
  isStarred: false,
  isUnread: false,
  labelActions: null,
  labels: [],
  messageId: "message-one",
  sessionScope: "scope-one",
  subject: "Subject",
  to: "member@example.com",
};

describe("message reader safety copy", () => {
  it("limits the sanitized claim to the message body", () => {
    const noop = vi.fn();
    const html = renderToStaticMarkup(createElement(MessageReaderView, {
      activeRole: "inbox",
      canPermanentlyDelete: false,
      isComposerReady: true,
      isMutating: false,
      onArchive: noop,
      onClose: noop,
      onDelete: noop,
      onForward: noop,
      onReply: noop,
      onReplyAll: noop,
      onRequestDestroy: noop,
      onRequestMove: noop,
      onRestore: noop,
      onToggleRead: noop,
      onToggleStar: noop,
      reader,
    }));

    expect(html).toContain("Sanitized message body");
    expect(html).not.toContain("Sanitized message content");
    expect(html).not.toContain('aria-live="polite"');
    expect(html).toContain("Message details");
    expect(html).toContain('aria-label="Actions for this message"');
  });
});
