import type { MailboxRole } from "@/domain/mail/mail";
import type { SnoozeBulkOutcome } from "@/domain/mail/snooze";
import type { MailboxId, MessageId } from "@/domain/shared/brand";

export const mailboxCanSnooze = (
  mailbox: { readonly id: MailboxId; readonly role: MailboxRole } | null,
  snoozedMailboxId: MailboxId | null,
  supported: boolean,
): boolean => Boolean(supported && mailbox && mailbox.id !== snoozedMailboxId &&
  !["drafts", "sent", "spam", "trash"].includes(mailbox.role));

export const snoozeOutcome = (outcomes: readonly SnoozeBulkOutcome[]): {
  readonly accepted: readonly MessageId[]; readonly rejected: readonly MessageId[];
} => ({
  accepted: outcomes.filter(({ status }) => status === "accepted").map(({ messageId }) => messageId),
  rejected: outcomes.filter(({ status }) => status === "rejected").map(({ messageId }) => messageId),
});

export const isCurrentSnoozeRequest = (
  activeScope: string,
  requestScope: string,
  activeOperation: number,
  requestOperation: number,
): boolean => Boolean(requestScope) && activeScope === requestScope &&
  activeOperation === requestOperation;
