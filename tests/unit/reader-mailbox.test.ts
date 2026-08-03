import { describe, expect, it } from "vitest";

import type { Mailbox, MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { resolveReaderMailbox } from "@/presentation/features/mail-workspace/reader-mailbox";

const mailbox = (name: string): Mailbox => ({
  color: "#4f46e5", id: id.mailbox(name), name, parentId: null,
  role: name === "trash" ? "trash" : "inbox",
  rights: { mayAddItems: true, mayCreateChild: false, mayDelete: false,
    mayRemoveItems: true, mayRename: false }, sortOrder: 1, total: 1, unread: 0,
});

const message = (mailboxId: string): MessageDetail => ({
  attachments: [], cc: [], from: [], hasAttachment: false,
  htmlBody: null, id: id.message("message"), isStarred: false, isUnread: false,
  labelIds: [], mailboxIds: [id.mailbox(mailboxId)], preview: "", receivedAt: "",
  replyTo: [], size: 0, subject: "", textBody: "", threadId: id.thread("thread"),
  to: [],
});

describe("reader mailbox context", () => {
  it("keeps the active mailbox only when the selected message belongs to it", () => {
    const mailboxes = [mailbox("inbox"), mailbox("trash")];
    expect(resolveReaderMailbox(mailboxes, id.mailbox("inbox"), message("trash"))?.id)
      .toBe("trash");
    expect(resolveReaderMailbox(mailboxes, id.mailbox("trash"), message("trash"))?.id)
      .toBe("trash");
  });
});
