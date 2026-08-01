import { describe, expect, it } from "vitest";

import type { MessageDetail } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { emptyMockMailbox } from "@/infrastructure/providers/mock/mock-mailbox-empty";

const mailboxId = id.mailbox("mock-trash");
const message = (value: string, receivedAt: string): MessageDetail => ({
  attachments: [],
  cc: [],
  from: [],
  hasAttachment: false,
  htmlBody: null,
  id: id.message(value),
  isStarred: false,
  isUnread: false,
  labelIds: [],
  mailboxIds: [mailboxId],
  preview: "",
  receivedAt,
  replyTo: [],
  size: 1,
  subject: value,
  textBody: "",
  threadId: id.thread(`thread-${value}`),
  to: [],
});

describe("mock mailbox empty", () => {
  it("prepares before deletion and preserves later arrivals", () => {
    const messages = [message("before", "2026-08-01T10:00:00.000Z")];
    const prepared = emptyMockMailbox(messages, {
      limit: 100,
      mailboxId,
    }, new Date("2026-08-01T11:00:00.000Z"));
    expect(prepared).toMatchObject({ complete: false, processed: 0, removed: 0 });
    expect(messages).toHaveLength(1);
    messages.push(message("after", "2026-08-01T12:00:00.000Z"));

    const finished = emptyMockMailbox(messages, {
      cursor: prepared.cursor!,
      limit: 100,
      mailboxId,
    });

    expect(finished).toEqual({
      complete: true,
      cursor: null,
      processed: 1,
      removed: 1,
    });
    expect(messages.map(({ id: value }) => value)).toEqual(["after"]);
  });

  it("rejects a cursor from another mailbox", () => {
    const messages = [message("before", "2026-08-01T10:00:00.000Z")];
    const prepared = emptyMockMailbox(messages, {
      limit: 1,
      mailboxId,
    }, new Date("2026-08-01T11:00:00.000Z"));

    expect(() => emptyMockMailbox(messages, {
      cursor: prepared.cursor!,
      limit: 1,
      mailboxId: id.mailbox("mock-spam"),
    })).toThrow("Mailbox empty cursor is invalid");
  });
});
