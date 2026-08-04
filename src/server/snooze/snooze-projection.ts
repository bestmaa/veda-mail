import "server-only";

import type { SnoozedMessageBook } from "@/domain/mail/snooze";
import { id } from "@/domain/shared/brand";
import type { SnoozeJobBook } from "@/server/snooze/snooze-record";

export const projectSnoozeBook = (
  book: SnoozeJobBook | null,
): SnoozedMessageBook => ({
  messages: (book?.jobs ?? []).map((job) => ({
    attemptCount: job.attemptCount, createdAt: job.createdAt,
    from: job.from, id: job.id, lastError: job.lastError,
    messageId: id.message(job.messageId), status: job.state,
    subject: job.subject, updatedAt: job.updatedAt, wakeAt: job.wakeAt,
  })).sort((left, right) => left.wakeAt.localeCompare(right.wakeAt)),
  revision: book?.revision ?? null,
  snoozedMailboxId: book?.mailbox?.id ? id.mailbox(book.mailbox.id) : null,
  version: 1,
});
