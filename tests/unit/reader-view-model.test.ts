import { describe, expect, it, vi } from "vitest";

import type { MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { ConversationViewModel } from "@/presentation/features/mail-workspace/conversation.view-model";
import { createReaderViewModel } from "@/presentation/features/mail-workspace/reader.view-model";

const message: MessageDetail = {
  attachments: [{
    disposition: "attachment",
    id: id.attachment("attachment-private"),
    mimeType: "text/plain",
    name: "notes.txt",
    size: 2_048,
  }],
  cc: [{ email: "grace@example.com", name: "Grace" }],
  from: [{ email: "ada@example.com", name: "Ada" }],
  hasAttachment: true,
  htmlBody: null,
  id: id.message("message-private"),
  isStarred: false,
  isUnread: false,
  labelIds: [],
  mailboxIds: [id.mailbox("inbox")],
  preview: "Hello",
  receivedAt: "2026-08-03T10:00:00.000Z",
  replyTo: [{ email: "reply@example.com", name: null }],
  size: 4_096,
  subject: "Project",
  textBody: "Hello",
  threadId: id.thread("thread-private"),
  to: [{ email: "member@example.com", name: "Member" }],
};

const conversation: ConversationViewModel = {
  error: null,
  isLoading: false,
  isLoadingMore: false,
  items: [
    { avatar: "A", date: "03 Aug", id: "message-private", isActive: true,
      isUnread: false, onOpen: vi.fn(), preview: "", sender: "Ada", subject: "Project" },
    { avatar: "G", date: "03 Aug", id: "message-next", isActive: false,
      isUnread: false, onOpen: vi.fn(), preview: "", sender: "Grace", subject: "Re: Project" },
  ],
  loadMore: null,
  strategyLabel: "Provider thread",
  total: 2,
  truncated: false,
};

describe("reader view model details", () => {
  it("projects normalized portable details for the selected message", () => {
    const model = createReaderViewModel({
      archiveDownload: { download: vi.fn(), error: null, href: null, isPreparing: false },
      attachmentDownload: { download: vi.fn(), error: null, href: null, isDownloading: false },
      attachmentPreview: { close: vi.fn(), error: null, href: null, isLoading: false,
        isOpen: false, name: "", open: vi.fn(), restoreFocus: vi.fn(), url: null },
      canArchive: true,
      conversation,
      deletingLabelIds: new Set(),
      handleSessionFailure: () => false,
      isLoading: false,
      labelCapability: "supported",
      labels: [],
      message,
      onSetLabel: vi.fn(),
      readerError: null,
      sessionScope: "scope-one",
    });

    expect(model?.details).toMatchObject({
      attachments: "1 file (2 KB)",
      cc: '"Grace" <grace@example.com>',
      conversationPosition: "Message 1 of 2",
      from: '"Ada" <ada@example.com>',
      messageSize: "4 KB",
      replyTo: "reply@example.com",
      to: '"Member" <member@example.com>',
    });
    expect(JSON.stringify(model?.details)).not.toContain("message-private");
    expect(JSON.stringify(model?.details)).not.toContain("thread-private");
  });
});
