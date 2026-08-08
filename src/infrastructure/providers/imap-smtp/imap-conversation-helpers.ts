import "server-only";

import type {
  FetchMessageObject,
  FetchQueryObject,
  ImapFlow,
  ListResponse,
  SearchObject,
} from "imapflow";

import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import type { MessageSummary } from "@/domain/mail/mail";
import { mapImapSummary } from "@/infrastructure/providers/imap-smtp/imap-mail.mapper";
import {
  boundedHeaderSourceQuery,
  boundedImapHeaders,
} from "@/infrastructure/providers/imap-smtp/imap-bounded-headers";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

export const MAX_READABLE_MAILBOXES = 32;
const MAX_IDENTIFIER_LENGTH = 998;
export const MAX_GRAPH_IDENTIFIERS = 64;
export const IDENTIFIERS_PER_SEARCH = 16;
export const MAX_IDENTIFIER_SEARCH_BATCHES = 4;

export const conversationFetchQuery = {
  ...boundedHeaderSourceQuery,
  bodyStructure: true,
  envelope: true,
  flags: true,
  internalDate: true,
  size: true,
  threadId: true,
  uid: true,
} satisfies FetchQueryObject;

export interface HeaderGraphNode {
  readonly identifiers: readonly string[];
  readonly ownIdentifier: string | null;
  readonly truncated: boolean;
}

export interface CollectedMessage {
  readonly emailId: string | null;
  readonly summary: MessageSummary;
}

export interface ConversationFetchBudget {
  remaining: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const normalizedIdentifier = (value?: string | null): string | null => {
  const candidate = value?.trim();
  if (
    !candidate || candidate.length > MAX_IDENTIFIER_LENGTH ||
    hasHeaderControlCharacter(candidate) ||
    !/^<[^<>\s]{1,996}>$/u.test(candidate)
  ) return null;
  return candidate.toLowerCase();
};

const identifiersFromHeader = (headers?: Buffer, truncated = false): {
  readonly identifiers: readonly string[];
  readonly truncated: boolean;
} => {
  if (!headers) return { identifiers: [], truncated };
  const unfolded = headers.toString("utf8").replace(/\r?\n[\t ]+/gu, " ");
  const values: string[] = [];
  for (const line of unfolded.split(/\r?\n/gu)) {
    if (!/^(?:in-reply-to|references)\s*:/iu.test(line)) continue;
    for (const match of line.matchAll(/<[^<>\s]{1,996}>/gu)) {
      const identifier = normalizedIdentifier(match[0]);
      if (identifier) values.push(identifier);
    }
  }
  return { identifiers: values, truncated: false };
};

export const graphNode = (message: FetchMessageObject): HeaderGraphNode => {
  const ownIdentifier = normalizedIdentifier(message.envelope?.messageId);
  const identifiers = new Set<string>();
  if (ownIdentifier) identifiers.add(ownIdentifier);
  const parent = normalizedIdentifier(message.envelope?.inReplyTo);
  if (parent) identifiers.add(parent);
  const bounded = boundedImapHeaders(message);
  const header = identifiersFromHeader(bounded.headers, bounded.truncated);
  header.identifiers.forEach((value) => identifiers.add(value));
  return {
    identifiers: [...identifiers].sort(compareStrings),
    ownIdentifier,
    truncated: header.truncated,
  };
};

export const safeThreadId = (value?: string): string | null => {
  const candidate = value?.trim();
  return candidate && candidate.length <= 1_024 &&
    !hasHeaderControlCharacter(candidate) ? candidate : null;
};

export const supportsNativeThreadId = (client: ImapFlow): boolean =>
  client.capabilities?.has("OBJECTID") === true ||
  client.capabilities?.has("X-GM-EXT-1") === true;

export const readableConversationMailboxes = (
  listed: readonly ListResponse[],
  anchorMailbox: string,
): { readonly mailboxes: readonly string[]; readonly truncated: boolean } => {
  const paths = [...new Set(listed.filter((mailbox) =>
    mailbox.listed && !mailbox.flags?.has("\\Noselect")).map(({ path }) => path))]
    .sort(compareStrings);
  if (!paths.includes(anchorMailbox)) throw new Error("Message not found.");
  const ordered = [anchorMailbox, ...paths.filter((path) => path !== anchorMailbox)];
  return {
    mailboxes: ordered.slice(0, MAX_READABLE_MAILBOXES),
    truncated: ordered.length > MAX_READABLE_MAILBOXES,
  };
};

export const conversationSummary = (
  config: ImapSmtpMemberConfig,
  mailbox: string,
  uidValidity: bigint,
  message: FetchMessageObject,
): MessageSummary => mapImapSummary(mailbox, message, { config, uidValidity });

export const stableConversationMessages = (
  messages: readonly CollectedMessage[],
): readonly CollectedMessage[] => messages.toSorted((left, right) => {
  const received = compareStrings(left.summary.receivedAt, right.summary.receivedAt);
  return received || compareStrings(left.summary.id, right.summary.id);
});

export const searchConversationUids = async (
  client: ImapFlow,
  search: SearchObject,
): Promise<readonly number[]> => {
  const result = await client.search(search, { uid: true });
  return result === false ? [] : [...new Set(result)]
    .filter((uid) => Number.isSafeInteger(uid) && uid > 0)
    .sort((a, b) => a - b);
};

export const fetchConversationCandidates = async (
  client: ImapFlow,
  uids: readonly number[],
  budget: ConversationFetchBudget,
): Promise<{ readonly messages: readonly FetchMessageObject[]; readonly truncated: boolean }> => {
  const bounded = uids.slice(0, budget.remaining);
  budget.remaining -= bounded.length;
  const fetched = bounded.length
    ? await client.fetchAll(bounded, conversationFetchQuery, { uid: true }) : [];
  return {
    messages: fetched.filter(({ uid }) => bounded.includes(uid))
      .sort((left, right) => left.uid - right.uid),
    truncated: uids.length > bounded.length,
  };
};

export const identifierSearch = (identifiers: readonly string[]): SearchObject => ({
  or: identifiers.flatMap((identifier) => [
    { header: { "message-id": identifier } },
    { header: { "in-reply-to": identifier } },
    { header: { references: identifier } },
  ]),
});

export const identifierSetsIntersect = (
  identifiers: readonly string[], searched: ReadonlySet<string>,
): boolean => identifiers.some((identifier) => searched.has(identifier));
