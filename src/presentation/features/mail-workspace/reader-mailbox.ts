import type { Mailbox, MessageDetail } from "@/domain/mail/mail";
import type { MailboxId } from "@/domain/shared/brand";

export const resolveReaderMailbox = (
  mailboxes: readonly Mailbox[],
  activeMailboxId: MailboxId | null,
  message: MessageDetail | null,
): Mailbox | null => {
  if (!message) return null;
  const active = mailboxes.find(({ id }) => id === activeMailboxId);
  if (active && message.mailboxIds.includes(active.id)) return active;
  return mailboxes.find(({ id }) => message.mailboxIds.includes(id)) ?? null;
};
