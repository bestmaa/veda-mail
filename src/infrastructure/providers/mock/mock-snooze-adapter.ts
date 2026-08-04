import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import type {
  SnoozeOwnedMailbox,
  SnoozePreflightInput,
  SnoozePreflightResult,
  SnoozeProviderInspection,
  SnoozeProviderOperationResult,
  SnoozeProviderPlan,
} from "@/domain/mail/snooze";
import { mockMailboxIds } from "@/infrastructure/providers/mock/mock-seed";
import { id } from "@/domain/shared/brand";

type MockPlan = Extract<SnoozeProviderPlan, { kind: "jmap" }>;

export const mockSnoozeMailbox = (): SnoozeOwnedMailbox => ({
  id: mockMailboxIds.snoozed,
  kind: "jmap",
  name: "Snoozed",
});

const owned = (plan: MockPlan): SnoozeOwnedMailbox => ({
  id: plan.snoozedMailboxId,
  kind: "jmap",
  name: plan.snoozedMailboxName,
});

const messageFor = (
  messages: readonly MessageDetail[],
  messageId: string,
): MessageDetail => {
  const message = messages.find(({ id }) => id === messageId);
  if (!message) throw new Error("Message not found.");
  return message;
};

export const preflightMockSnooze = (
  messages: readonly MessageDetail[],
  input: SnoozePreflightInput,
): SnoozePreflightResult => {
  const message = messageFor(messages, input.messageId);
  if (!message.mailboxIds.includes(input.sourceMailboxId) ||
    input.ownedMailbox.kind !== "jmap") {
    throw new Error("The message is outside its source mailbox.");
  }
  return {
    from: message.from.map(({ email }) => email),
    plan: {
      emailId: message.id,
      expectedState: null,
      inboxMailboxId: mockMailboxIds.inbox,
      kind: "jmap",
      originalMailboxIds: [...message.mailboxIds],
      snoozedMailboxId: mockMailboxIds.snoozed,
      snoozedMailboxName: "Snoozed",
      sourceMailboxId: input.sourceMailboxId,
    },
    subject: message.subject,
  };
};

export const inspectMockSnooze = (
  messages: readonly MessageDetail[],
  plan: MockPlan,
): SnoozeProviderInspection => {
  const message = messages.find(({ id }) => id === plan.emailId);
  return {
    ownedMailbox: owned(plan),
    plan,
    state: !message ? "deleted" :
      message.mailboxIds.includes(mockMailboxIds.snoozed) ? "snoozed" : "visible",
  };
};

const replace = (
  messages: MessageDetail[],
  plan: MockPlan,
  operation: "hide" | "restore",
): SnoozeProviderOperationResult => {
  const index = messages.findIndex(({ id }) => id === plan.emailId);
  const current = messages[index];
  if (!current) throw new Error("Message not found.");
  const remove = operation === "hide"
    ? plan.sourceMailboxId : mockMailboxIds.snoozed;
  const add = operation === "hide"
    ? mockMailboxIds.snoozed : plan.sourceMailboxId || plan.inboxMailboxId;
  const memberships = new Set(current.mailboxIds);
  if (operation === "restore" && !memberships.has(mockMailboxIds.snoozed)) {
    return { ownedMailbox: owned(plan), plan };
  }
  memberships.delete(id.mailbox(remove));
  memberships.add(id.mailbox(add));
  messages[index] = { ...current, mailboxIds: [...memberships] };
  return { ownedMailbox: owned(plan), plan };
};

export const hideMockSnooze = (messages: MessageDetail[], plan: MockPlan) =>
  replace(messages, plan, "hide");
export const restoreMockSnooze = (messages: MessageDetail[], plan: MockPlan) =>
  replace(messages, plan, "restore");
