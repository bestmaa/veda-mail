import type { MailWorkspace, MessageSummary } from "@/domain/mail/mail";

export type NotificationContent = "details" | "private";

export interface NewMailEvent {
  readonly count: number;
  readonly message: MessageSummary | null;
}

const inbox = (workspace: MailWorkspace) =>
  workspace.mailboxes.find(({ role }) => role === "inbox") ?? null;

export const detectNewMail = (
  previous: MailWorkspace,
  next: MailWorkspace,
): NewMailEvent | null => {
  if (previous.account.id !== next.account.id ||
      previous.account.providerId !== next.account.providerId) return null;
  const previousInbox = inbox(previous);
  const nextInbox = inbox(next);
  if (!previousInbox || !nextInbox) return null;
  const visibleInbox = next.selectedMailboxId === nextInbox.id;
  const previousIds = new Set(previous.messages.items.map(({ id }) => id));
  const newVisibleMessages = visibleInbox
    ? next.messages.items.filter(({ id }) => !previousIds.has(id))
    : [];
  const count = Math.max(
    newVisibleMessages.length,
    nextInbox.total - previousInbox.total,
  );
  if (count <= 0) return null;
  return { count, message: newVisibleMessages[0] ?? null };
};

export const newMailNotificationText = (
  event: NewMailEvent,
  content: NotificationContent,
): { readonly body: string; readonly title: string } => {
  if (content === "details" && event.message) {
    const sender = event.message.from[0]?.name ??
      event.message.from[0]?.email ?? "Unknown sender";
    return {
      body: event.message.subject || "(No subject)",
      title: event.count > 1 ? `${sender} and ${event.count - 1} more` : sender,
    };
  }
  return {
    body: event.count === 1 ? "You have a new message." :
      `You have ${event.count} new messages.`,
    title: "New mail in Veda Mail",
  };
};
