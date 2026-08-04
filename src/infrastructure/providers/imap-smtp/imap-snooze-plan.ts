import "server-only";

import type { ImapFlow, ListResponse } from "imapflow";

import type {
  SnoozeOwnedMailbox,
  SnoozeProviderPlan,
} from "@/domain/mail/snooze";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { findImapMailboxByObjectId } from "@/infrastructure/providers/imap-smtp/imap-snooze-mailbox";

export type ImapSnoozePlan = Extract<SnoozeProviderPlan, { kind: "imap" }>;

export const classifyImapSnoozeState = (
  inSource: boolean,
  inSnoozed: boolean,
): "deleted" | "snoozed" | "visible" => {
  if (inSource && inSnoozed) {
    throw new Error("The snoozed message exists in both source and target.");
  }
  if (inSnoozed) return "snoozed";
  return inSource ? "visible" : "deleted";
};

export const assertImapSnoozeScope = (
  plan: ImapSnoozePlan,
  accountScope: string,
): void => {
  if (plan.accountScope !== accountScope) throw new Error("Snooze account mismatch.");
};

export const imapSnoozeOwnedMailbox = (
  plan: ImapSnoozePlan,
): SnoozeOwnedMailbox => ({
  accountScope: plan.accountScope,
  id: encodeMailboxId(plan.snoozedMailbox),
  kind: "imap",
  name: plan.snoozedMailbox,
  objectId: plan.snoozedMailboxObjectId,
});

export const resolveImapSnoozedPath = async (
  client: ImapFlow,
  plan: ImapSnoozePlan,
  listed?: readonly ListResponse[],
): Promise<string | null> => {
  const mailboxes = listed ?? await client.list();
  if (mailboxes.some(({ path }) => path === plan.snoozedMailbox)) {
    return plan.snoozedMailbox;
  }
  return findImapMailboxByObjectId(
    client, mailboxes, plan.snoozedMailboxObjectId,
  );
};

export const imapSnoozeSourceExists = async (
  client: ImapFlow,
  plan: ImapSnoozePlan,
): Promise<boolean> => {
  try {
    const opened = await client.mailboxOpen(plan.sourceMailbox);
    if (opened.uidValidity.toString() !== plan.sourceUidValidity) return false;
    const message = await client.fetchOne(plan.sourceUid, { uid: true }, { uid: true });
    return Boolean(message && message.uid === plan.sourceUid);
  } catch { return false; }
};
