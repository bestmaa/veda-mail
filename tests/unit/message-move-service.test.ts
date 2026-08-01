import { describe, expect, it } from "vitest";

import type { Mailbox, MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import {
  authorizeMessageMoveMailboxes,
  authorizeMessageMoveMembership,
} from "@/server/messages/message-move.service";
import { ApiError } from "@/transport/http/api-error";

const source = (remove = true): Mailbox => ({
  color: "#000", id: id.mailbox("inbox"), name: "Inbox", parentId: null,
  rights: { mayAddItems: true, mayCreateChild: true, mayDelete: false,
    mayRemoveItems: remove, mayRename: false },
  role: "inbox", sortOrder: 0, total: 1, unread: 0,
});
const destination = (
  role: Mailbox["role"] = "custom",
  add = true,
): Mailbox => ({
  color: "#000", id: id.mailbox(role), name: role, parentId: null,
  rights: { mayAddItems: add, mayCreateChild: true, mayDelete: false,
    mayRemoveItems: true, mayRename: false },
  role, sortOrder: 0, total: 0, unread: 0,
});
const mutation = {
  destinationMailboxId: id.mailbox("custom"),
  sourceMailboxId: id.mailbox("inbox"),
  type: "move" as const,
};
const message = (mailboxIds: MessageDetail["mailboxIds"]): MessageDetail => ({
  attachments: [], cc: [], from: [], hasAttachment: false, htmlBody: null,
  id: id.message("message-a"), isStarred: false, isUnread: false, labelIds: [],
  mailboxIds, preview: "", receivedAt: "2026-08-01T00:00:00.000Z",
  replyTo: [], size: 1, subject: "Move me", textBody: "",
  threadId: id.thread("thread-a"), to: [],
});

describe("message move service policy", () => {
  it("authorizes a distinct writable destination and exact source membership", () => {
    const context = authorizeMessageMoveMailboxes([
      source(), destination(),
    ], mutation);
    expect(() => authorizeMessageMoveMembership(
      message([id.mailbox("inbox")]), context,
    )).not.toThrow();
  });

  it.each([
    { mailboxes: [source(false), destination()], code: "MESSAGE_MOVE_SOURCE_FORBIDDEN" },
    { mailboxes: [source(), destination("custom", false)], code: "MESSAGE_MOVE_DESTINATION_FORBIDDEN" },
    { mailboxes: [source(), { ...destination("drafts"), id: id.mailbox("custom") }], code: "MESSAGE_MOVE_DESTINATION_FORBIDDEN" },
    { mailboxes: [source()], code: "MESSAGE_MOVE_MAILBOX_UNAVAILABLE" },
  ])("fails closed for unauthorized mailbox topology", ({ mailboxes, code }) => {
    try {
      authorizeMessageMoveMailboxes(mailboxes, mutation);
      throw new Error("Expected policy rejection.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(code);
    }
  });

  it("rejects stale source membership and pre-existing destination membership", () => {
    const context = authorizeMessageMoveMailboxes([source(), destination()], mutation);
    expect(() => authorizeMessageMoveMembership(
      message([id.mailbox("archive")]), context,
    )).toThrow("no longer in");
    expect(() => authorizeMessageMoveMembership(
      message([id.mailbox("inbox"), id.mailbox("custom")]), context,
    )).toThrow("already in");
  });
});
