import "server-only";

import type { ImapFlow } from "imapflow";

import type { SnoozeProviderOperationResult } from "@/domain/mail/snooze";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import { resolveImapRestoreMailbox } from "@/infrastructure/providers/imap-smtp/imap-snooze-mailbox";
import {
  markerUids,
  removeAndVerifyMarker,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-marker";
import {
  imapSnoozeOwnedMailbox,
  type ImapSnoozePlan,
  resolveImapSnoozedPath,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-plan";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const markerIn = async (client: ImapFlow, path: string, marker: string) => {
  const opened = await client.mailboxOpen(path);
  const matches = await markerUids(client, marker);
  return matches.length === 1
    ? { uid: matches[0]!, uidValidity: opened.uidValidity.toString() } : null;
};

export const restoreImapSnooze = (
  config: ImapSmtpMemberConfig,
  plan: ImapSnoozePlan,
): Promise<SnoozeProviderOperationResult> => withImapClient(config, async (client) => {
  const mailboxes = await client.list();
  const destination = await resolveImapRestoreMailbox(
    client, mailboxes, plan.destinationMailbox, plan.sourceMailboxObjectId,
  );
  const snoozedPath = await resolveImapSnoozedPath(client, plan, mailboxes);
  const source = snoozedPath ? await markerIn(client, snoozedPath, plan.marker) : null;
  if (!source) {
    const recovered = await markerIn(client, destination.path, plan.marker);
    if (!recovered) return { ownedMailbox: imapSnoozeOwnedMailbox(plan), plan };
    await client.mailboxOpen(destination.path);
    await removeAndVerifyMarker(client, recovered.uid, plan.marker);
    return { ownedMailbox: imapSnoozeOwnedMailbox(plan), plan };
  }
  if (!snoozedPath) throw new Error("The Snoozed mailbox identity is unavailable.");
  await client.mailboxOpen(snoozedPath);
  const moved = await client.messageMove(source.uid, destination.path, { uid: true });
  if (!moved) throw new Error("The provider did not restore the snoozed message.");
  const restored = await markerIn(client, destination.path, plan.marker);
  if (!restored) throw new Error("The restored message identity is ambiguous.");
  const mappedUid = moved.uidMap?.get(source.uid);
  if (mappedUid !== undefined && mappedUid !== restored.uid) {
    throw new Error("The restore COPYUID does not match the recovery marker.");
  }
  await client.mailboxOpen(destination.path);
  await removeAndVerifyMarker(client, restored.uid, plan.marker);
  return { ownedMailbox: imapSnoozeOwnedMailbox(plan), plan };
});
