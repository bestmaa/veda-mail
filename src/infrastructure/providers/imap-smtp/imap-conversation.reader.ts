import "server-only";

import type { FetchMessageObject, ImapFlow } from "imapflow";

import {
  CONVERSATION_PAGE_SIZE,
  MAX_CONVERSATION_MESSAGES,
  type ConversationPage,
  type ConversationQuery,
} from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import {
  assertConversationSnapshot,
  conversationProviderPosition,
  conversationSnapshot,
  nextConversationProviderCursor,
} from "@/infrastructure/providers/conversation-provider-cursor";
import {
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import {
  conversationFetchQuery,
  conversationSummary,
  fetchConversationCandidates,
  graphNode,
  identifierSearch,
  identifierSetsIntersect,
  IDENTIFIERS_PER_SEARCH,
  MAX_GRAPH_IDENTIFIERS,
  MAX_IDENTIFIER_SEARCH_BATCHES,
  readableConversationMailboxes,
  safeThreadId,
  searchConversationUids,
  stableConversationMessages,
  supportsNativeThreadId,
  type CollectedMessage,
  type ConversationFetchBudget,
} from "@/infrastructure/providers/imap-smtp/imap-conversation-helpers";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const nativeConversation = async (input: {
  readonly anchor: FetchMessageObject;
  readonly anchorMailbox: string;
  readonly anchorUidValidity: bigint;
  readonly client: ImapFlow;
  readonly config: ImapSmtpMemberConfig;
  readonly mailboxes: readonly string[];
  readonly initiallyTruncated: boolean;
  readonly threadId: string;
  readonly fetchBudget: ConversationFetchBudget;
}): Promise<{ readonly messages: readonly CollectedMessage[]; readonly truncated: boolean }> => {
  const anchorSummary = conversationSummary(
    input.config, input.anchorMailbox, input.anchorUidValidity, input.anchor,
  );
  const anchorEmailId = input.anchor.emailId?.trim() || null;
  const messages: CollectedMessage[] = [{
    emailId: anchorEmailId, summary: anchorSummary,
  }];
  const seenMessages = new Set<string>([anchorSummary.id]);
  const seenProviderEmails = new Set<string>(anchorEmailId ? [anchorEmailId] : []);
  let truncated = input.initiallyTruncated;

  for (const mailbox of input.mailboxes) {
    const opened = await input.client.mailboxOpen(mailbox, { readOnly: true });
    const uids = await searchConversationUids(
      input.client, { threadId: input.threadId },
    );
    const candidates = await fetchConversationCandidates(
      input.client, uids, input.fetchBudget,
    );
    truncated ||= candidates.truncated;
    for (const candidate of candidates.messages) {
      if (safeThreadId(candidate.threadId) !== input.threadId) continue;
      const summary = conversationSummary(
        input.config, mailbox, opened.uidValidity, candidate,
      );
      const providerEmailId = candidate.emailId?.trim() || null;
      if (seenMessages.has(summary.id) ||
          (providerEmailId && seenProviderEmails.has(providerEmailId))) continue;
      if (messages.length >= MAX_CONVERSATION_MESSAGES) {
        truncated = true; break;
      }
      seenMessages.add(summary.id);
      if (providerEmailId) seenProviderEmails.add(providerEmailId);
      messages.push({ emailId: providerEmailId, summary });
    }
    if (messages.length >= MAX_CONVERSATION_MESSAGES) break;
    if (input.fetchBudget.remaining === 0) {
      truncated = true; break;
    }
  }
  return { messages, truncated };
};

const referenceConversation = async (input: {
  readonly anchor: FetchMessageObject;
  readonly anchorMailbox: string;
  readonly anchorUidValidity: bigint;
  readonly client: ImapFlow;
  readonly config: ImapSmtpMemberConfig;
  readonly mailboxes: readonly string[];
  readonly initiallyTruncated: boolean;
  readonly fetchBudget: ConversationFetchBudget;
}): Promise<{ readonly messages: readonly CollectedMessage[]; readonly truncated: boolean }> => {
  const anchorSummary = conversationSummary(
    input.config, input.anchorMailbox, input.anchorUidValidity, input.anchor,
  );
  const messages: CollectedMessage[] = [{ emailId: null, summary: anchorSummary }];
  const seenMessages = new Set<string>([anchorSummary.id]);
  const anchorNode = graphNode(input.anchor);
  const knownIdentifiers = new Set(anchorNode.identifiers);
  const pendingIdentifiers = [...knownIdentifiers].sort();
  const searchedIdentifiers = new Set<string>();
  let batches = 0;
  let truncated = input.initiallyTruncated || anchorNode.truncated;

  while (pendingIdentifiers.length &&
         batches < MAX_IDENTIFIER_SEARCH_BATCHES &&
         input.fetchBudget.remaining > 0 &&
         messages.length < MAX_CONVERSATION_MESSAGES) {
    const batch = pendingIdentifiers.splice(0, IDENTIFIERS_PER_SEARCH)
      .filter((identifier) => !searchedIdentifiers.has(identifier));
    if (!batch.length) continue;
    batches += 1;
    batch.forEach((identifier) => searchedIdentifiers.add(identifier));
    const searched = new Set(batch);

    for (const mailbox of input.mailboxes) {
      const opened = await input.client.mailboxOpen(mailbox, { readOnly: true });
      const uids = await searchConversationUids(
        input.client, identifierSearch(batch),
      );
      const candidates = await fetchConversationCandidates(
        input.client, uids, input.fetchBudget,
      );
      truncated ||= candidates.truncated;
      for (const candidate of candidates.messages) {
        const node = graphNode(candidate);
        truncated ||= node.truncated;
        if (!identifierSetsIntersect(node.identifiers, searched)) continue;
        const summary = conversationSummary(
          input.config, mailbox, opened.uidValidity, candidate,
        );
        if (!seenMessages.has(summary.id)) {
          if (messages.length >= MAX_CONVERSATION_MESSAGES) {
            truncated = true; break;
          }
          seenMessages.add(summary.id);
          messages.push({ emailId: null, summary });
        }
        for (const identifier of node.identifiers) {
          if (knownIdentifiers.size >= MAX_GRAPH_IDENTIFIERS) {
            if (!knownIdentifiers.has(identifier)) truncated = true;
          } else if (!knownIdentifiers.has(identifier)) {
            knownIdentifiers.add(identifier);
            pendingIdentifiers.push(identifier);
          }
        }
      }
      if (messages.length >= MAX_CONVERSATION_MESSAGES) break;
      if (input.fetchBudget.remaining === 0) {
        truncated = true; break;
      }
    }
    pendingIdentifiers.sort();
  }
  if (pendingIdentifiers.some((identifier) =>
    !searchedIdentifiers.has(identifier))) truncated = true;
  return { messages, truncated };
};

export const readImapConversation = async (
  config: ImapSmtpMemberConfig,
  query: ConversationQuery,
): Promise<ConversationPage> => {
  const position = conversationProviderPosition(query);
  let reference: ReturnType<typeof decodeScopedImapMessageId>;
  try {
    reference = decodeScopedImapMessageId(config, query.anchorMessageId);
  } catch {
    return Promise.reject(new Error("Message not found."));
  }
  return await withImapClient(config, async (client) => {
    const readable = readableConversationMailboxes(
      await client.list(), reference.mailbox,
    );
    const opened = await client.mailboxOpen(reference.mailbox, { readOnly: true });
    if (!imapUidValidityMatches(reference, opened.uidValidity)) {
      throw new Error("Message not found.");
    }
    const anchor = await client.fetchOne(
      reference.uid, conversationFetchQuery, { uid: true },
    );
    if (!anchor || anchor.uid !== reference.uid) throw new Error("Message not found.");
    const threadId = supportsNativeThreadId(client)
      ? safeThreadId(anchor.threadId) : null;
    const common = {
      anchor, anchorMailbox: reference.mailbox,
      anchorUidValidity: opened.uidValidity, client, config,
      fetchBudget: { remaining: MAX_CONVERSATION_MESSAGES - 1 },
      initiallyTruncated: readable.truncated, mailboxes: readable.mailboxes,
    };
    const result = threadId
      ? await nativeConversation({ ...common, threadId })
      : await referenceConversation(common);
    const ordered = stableConversationMessages(result.messages);
    const snapshot = conversationSnapshot(
      ordered.map(({ summary }) => summary),
    );
    assertConversationSnapshot(position.snapshot, snapshot);
    const items = ordered.slice(
      position.offset, position.offset + CONVERSATION_PAGE_SIZE,
    )
      .map(({ summary }) => summary);
    const nextOffset = position.offset + items.length;
    return {
      anchorMessageId: id.message(query.anchorMessageId), items,
      nextCursor: nextConversationProviderCursor(
        nextOffset, ordered.length, snapshot,
      ),
      strategy: threadId ? "native" : "references", total: ordered.length,
      truncated: result.truncated,
    };
  });
};
