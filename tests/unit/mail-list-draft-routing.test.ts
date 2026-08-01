import { describe, expect, it, vi } from "vitest";

import type { MailWorkspace } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { createMailListViewModel } from "@/presentation/features/mail-workspace/mail-list.view-model";

const draftsId = id.mailbox("drafts");
const workspace: MailWorkspace = {
  account: {
    email: "me@example.com",
    id: id.account("account-a"),
    name: "Me",
    providerId: id.provider("stalwart"),
  },
  draftCapability: { status: "supported" },
  mailboxes: [{
    color: "#6366f1", id: draftsId, name: "Drafts", role: "drafts",
    total: 1, unread: 0,
  }],
  messages: {
    items: [{
      from: [],
      hasAttachment: false,
      id: id.message("provider-draft-a"),
      isStarred: false,
      isUnread: false,
      mailboxIds: [draftsId],
      preview: "Draft body",
      receivedAt: "2026-07-31T10:00:00.000Z",
      size: 100,
      subject: "",
      threadId: id.thread("thread-a"),
      to: [{ email: "recipient@example.com", name: "Recipient" }],
    }],
    nextCursor: null,
    total: 1,
  },
  sessionExpiresAt: "2026-08-01T00:00:00.000Z",
  sessionScope: "account-a",
};

describe("draft mailbox list routing", () => {
  it("opens supported Drafts rows through the dedicated draft action", () => {
    const onOpenDraft = vi.fn();
    const onSelectMessage = vi.fn();
    const list = createMailListViewModel({
      activeMailboxId: draftsId,
      draftsEnabled: true,
      onOpenDraft,
      onSelectMailbox: vi.fn(),
      onSelectMessage,
      onToggleMessage: vi.fn(),
      selectedMessageIds: new Set(),
      selectionDisabled: false,
      workspace,
    });

    list.messages[0]?.onSelect();

    expect(onOpenDraft).toHaveBeenCalledWith("provider-draft-a");
    expect(onSelectMessage).not.toHaveBeenCalled();
    expect(list.messages[0]?.openLabel).toBe("Edit draft (No subject)");
    expect(list.messages[0]?.sender).toBe("To: Recipient");
  });

  it("keeps generic reader routing when provider draft editing is unsupported", () => {
    const onOpenDraft = vi.fn();
    const onSelectMessage = vi.fn();
    const list = createMailListViewModel({
      activeMailboxId: draftsId,
      draftsEnabled: false,
      onOpenDraft,
      onSelectMailbox: vi.fn(),
      onSelectMessage,
      onToggleMessage: vi.fn(),
      selectedMessageIds: new Set(),
      selectionDisabled: false,
      workspace,
    });

    list.messages[0]?.onSelect();
    expect(onOpenDraft).not.toHaveBeenCalled();
    expect(onSelectMessage).toHaveBeenCalledWith("provider-draft-a");
  });
});
