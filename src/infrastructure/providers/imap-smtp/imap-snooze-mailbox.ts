import "server-only";

import type { ImapFlow, ListResponse } from "imapflow";

export const IMAP_SNOOZED_MAILBOX_PREFIX = "Snoozed · Veda Mail ";

const selectable = (mailbox: ListResponse): boolean =>
  mailbox.listed && !mailbox.flags.has("\\Noselect");

export const findImapSnoozedMailbox = (
  mailboxes: readonly ListResponse[],
  expectedName: string,
): ListResponse | null => {
  const matches = mailboxes.filter(({ parentPath, name }) =>
    !parentPath && name === expectedName);
  if (matches.length > 1 || (matches[0] && !selectable(matches[0]))) {
    throw new Error("The Snoozed mailbox is unavailable or ambiguous.");
  }
  return matches[0] ?? null;
};

export const ensureImapSnoozedMailbox = async (
  client: ImapFlow,
  expectedName: string,
): Promise<string> => {
  const existing = findImapSnoozedMailbox(await client.list(), expectedName);
  if (existing) return existing.path;
  let path: string;
  try {
    path = (await client.mailboxCreate(expectedName)).path;
  } catch {
    const recovered = findImapSnoozedMailbox(await client.list(), expectedName);
    if (!recovered) throw new Error("The Snoozed mailbox create outcome is ambiguous.");
    path = recovered.path;
  }
  await client.mailboxSubscribe(path).catch(() => false);
  const confirmed = (await client.list()).find((mailbox) =>
    mailbox.path === path && selectable(mailbox));
  if (!confirmed) throw new Error("The provider did not create a usable Snoozed mailbox.");
  return confirmed.path;
};

export const imapInboxPath = (mailboxes: readonly ListResponse[]): string => {
  const inbox = mailboxes.find(({ path, specialUse }) =>
    path.toUpperCase() === "INBOX" || specialUse?.toLowerCase() === "\\inbox");
  if (!inbox || !selectable(inbox)) throw new Error("Inbox is unavailable.");
  return inbox.path;
};

export const resolveImapRestoreMailbox = async (
  client: ImapFlow,
  mailboxes: readonly ListResponse[],
  originalPath: string,
  objectId: string | null,
): Promise<{ readonly fallback: boolean; readonly path: string }> => {
  const exact = mailboxes.find(({ path }) => path === originalPath);
  if (exact && selectable(exact)) return { fallback: false, path: exact.path };
  const renamed = await findImapMailboxByObjectId(client, mailboxes, objectId);
  if (renamed) return { fallback: false, path: renamed };
  return { fallback: true, path: imapInboxPath(mailboxes) };
};

export const findImapMailboxByObjectId = async (
  client: ImapFlow,
  mailboxes: readonly ListResponse[],
  objectId: string | null,
): Promise<string | null> => {
  if (!objectId || !client.capabilities.has("OBJECTID") || mailboxes.length > 100) {
    return null;
  }
  const matches: string[] = [];
  for (const mailbox of mailboxes.filter(selectable)) {
    if ((await client.mailboxOpen(mailbox.path)).mailboxId === objectId) {
      matches.push(mailbox.path);
    }
  }
  if (matches.length > 1) throw new Error("The IMAP mailbox identity is ambiguous.");
  return matches[0] ?? null;
};
