import { describe, expect, it } from "vitest";
import { detectNewMail, newMailNotificationText } from "@/domain/mail/new-mail-notification";
import type { MailWorkspace, MessageSummary } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";

const inboxId = id.mailbox("inbox");
const message = (value: string): MessageSummary => ({
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  id: id.message(value),
  isStarred: false,
  isUnread: true,
  labelIds: [],
  mailboxIds: [inboxId],
  preview: "Private preview that must not enter notification text",
  receivedAt: "2026-08-05T08:00:00.000Z",
  size: 10,
  subject: "Release plan",
  threadId: id.thread(`thread-${value}`),
  to: [{ email: "member@example.com", name: null }],
});
const workspace = (
  total: number,
  items: readonly MessageSummary[],
  account = "member",
): MailWorkspace => ({
  account: { email: "member@example.com", id: id.account(account),
    name: "Member", providerId: id.provider("provider") },
  draftCapability: { status: "supported" },
  labelCapability: "supported",
  labels: [],
  mailboxes: [{ color: "#4338ca", id: inboxId, name: "Inbox", parentId: null,
    role: "inbox", rights: { mayCreateChild: false, mayDelete: false,
      mayRename: false }, sortOrder: 0, total, unread: total }],
  messageListPreferences: { confirmBeforeSend: false, density: "comfortable",
    keyboardShortcuts: false, showPreview: true, sort: "newest",
    undoSendSeconds: 0 },
  messages: { items, nextCursor: null, total },
  selectedMailboxId: inboxId,
  sessionExpiresAt: "2026-08-06T00:00:00.000Z",
  sessionScope: "scope",
});

describe("new mail notification policy", () => {
  it("detects a newly visible Inbox message", () => {
    const event = detectNewMail(workspace(1, [message("old")]),
      workspace(2, [message("new"), message("old")]));
    expect(event).toMatchObject({ count: 1, message: { id: "new" } });
  });

  it("does not notify for account changes or read-state-only changes", () => {
    expect(detectNewMail(workspace(1, [message("old")]),
      workspace(1, [message("old")]))).toBeNull();
    expect(detectNewMail(workspace(1, []), workspace(2, [], "other"))).toBeNull();
  });

  it("keeps private mode generic and excludes preview content", () => {
    const text = newMailNotificationText(
      { count: 2, message: message("new") },
      "private",
    );
    expect(text).toEqual({ body: "You have 2 new messages.",
      title: "New mail in Veda Mail" });
    expect(JSON.stringify(text)).not.toContain("Private preview");
  });

  it("shows only sender and subject after details are selected", () => {
    expect(newMailNotificationText(
      { count: 1, message: message("new") },
      "details",
    )).toEqual({ body: "Release plan", title: "Sender" });
  });
});
