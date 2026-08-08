import "server-only";

import type { ImapFlow } from "imapflow";

import { DraftUnavailableError } from "@/domain/mail/draft-errors";

const MAX_FALLBACK_DRAFTS = 256;
const MAX_FALLBACK_HEADER_BYTES = 8 * 1024;

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
  if (found !== false && found.length > 0) return found;

  // Some otherwise compliant IMAP servers (including Stalwart deployments)
  // can return an empty SEARCH HEADER result for private X-* fields. Fall back
  // to a bounded header-only fetch so draft idempotency and optimistic
  // replacement do not depend on a provider's custom-header index.
  const all = await client.search({ all: true }, { uid: true });
  if (all === false || all.length === 0) return [];
  const candidates = all.slice(-MAX_FALLBACK_DRAFTS);
  const escapedHeader = header.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const headerPattern = new RegExp(
    `(?:^|\\r?\\n)${escapedHeader}:\\s*([^\\r\\n]*(?:\\r?\\n[ \\t][^\\r\\n]*)*)`,
    "iu",
  );
  const messages = await client.fetchAll(
    candidates,
    { headers: [header], uid: true },
    { uid: true },
  );
  return messages.flatMap((message) => {
    if (!message.headers || message.headers.byteLength > MAX_FALLBACK_HEADER_BYTES) {
      return [];
    }
    const match = Buffer.from(message.headers).toString("utf8").match(headerPattern);
    const unfolded = match?.[1]?.replace(/\r?\n[ \t]+/gu, " ").trim();
    return unfolded === value && message.uid ? [message.uid] : [];
  });
};
