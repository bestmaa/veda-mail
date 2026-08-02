import "server-only";

import type { ImapFlow } from "imapflow";

import { DraftUnavailableError } from "@/domain/mail/draft-errors";

export interface ImapDraftContext {
  readonly mailbox: string;
  readonly uidValidity: bigint;
}

export const openImapDraftMailbox = async (
  client: ImapFlow,
  readOnly = false,
): Promise<ImapDraftContext> => {
  const mailbox = (await client.list()).find(
    ({ flags, specialUse }) =>
      !flags.has("\\Noselect") && specialUse?.toLowerCase() === "\\drafts",
  );
  if (!mailbox) throw new DraftUnavailableError();
  const opened = await client.mailboxOpen(mailbox.path, { readOnly });
  if (
    !readOnly &&
    (opened.readOnly || !client.capabilities.has("UIDPLUS"))
  ) {
    throw new DraftUnavailableError();
  }
  return { mailbox: mailbox.path, uidValidity: opened.uidValidity };
};

export const searchImapDraftHeader = async (
  client: ImapFlow,
  header: string,
  value: string,
): Promise<readonly number[]> => {
  const found = await client.search({ header: { [header]: value } }, { uid: true });
  return found === false ? [] : found;
};
