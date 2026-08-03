import "server-only";

import {
  MAX_CONVERSATION_MESSAGES,
  type ConversationPage,
  type ConversationQuery,
} from "@/domain/mail/conversation";
import {
  assertConversationSnapshot,
  conversationProviderPosition,
  conversationSnapshot,
  nextConversationProviderCursor,
} from "@/infrastructure/providers/conversation-provider-cursor";
import {
  jmapConversationAnchorSchema,
  jmapConversationGetResultSchema,
  jmapThreadSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-conversation.schema";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { mapMessageSummary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { jmapEmailSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const summaryProperties = [
  "id", "threadId", "mailboxIds", "keywords", "receivedAt", "size",
  "subject", "from", "to", "hasAttachment", "preview",
] as const;

const loadError = (): Error =>
  new Error("The conversation could not be loaded.");

const uniqueIds = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};

const boundedIds = (
  membership: readonly string[],
  anchorMessageId: string,
): readonly string[] => {
  const bounded = membership.slice(0, MAX_CONVERSATION_MESSAGES);
  if (bounded.includes(anchorMessageId)) return bounded;
  return [...bounded.slice(0, MAX_CONVERSATION_MESSAGES - 1), anchorMessageId];
};

const receivedTime = (value: string): number => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw loadError();
  return time;
};

export const readStalwartConversation = async (
  client: StalwartJmapClient,
  query: ConversationQuery,
): Promise<ConversationPage> => {
  try {
    const position = conversationProviderPosition(query);
    const session = await client.getSession();
    const accountId = session.primaryAccounts[JMAP_MAIL];
    if (!accountId) throw loadError();

    const anchorResponse = await client.request([["Email/get", {
      accountId, ids: [query.anchorMessageId], properties: ["id", "threadId"],
    }, "conversation-anchor"]], [JMAP_MAIL]);
    const anchorResult = client.result(
      anchorResponse, "conversation-anchor", "Email/get",
      jmapConversationGetResultSchema(jmapConversationAnchorSchema, 1),
    );
    const anchor = anchorResult.list[0];
    if (anchorResult.accountId !== accountId ||
        anchorResult.notFound.length !== 0 || anchorResult.list.length !== 1 ||
        anchor?.id !== query.anchorMessageId) throw loadError();

    const threadResponse = await client.request([["Thread/get", {
      accountId, ids: [anchor.threadId], properties: ["id", "emailIds"],
    }, "conversation-thread"]], [JMAP_MAIL]);
    const threadResult = client.result(
      threadResponse, "conversation-thread", "Thread/get",
      jmapConversationGetResultSchema(jmapThreadSchema, 1),
    );
    const thread = threadResult.list[0];
    const membership = uniqueIds(thread?.emailIds ?? []);
    if (threadResult.accountId !== accountId ||
        threadResult.notFound.length !== 0 || threadResult.list.length !== 1 ||
        thread?.id !== anchor.threadId ||
        !membership.includes(query.anchorMessageId)) throw loadError();

    const messageIds = boundedIds(membership, query.anchorMessageId);
    const emailResponse = await client.request([["Email/get", {
      accountId, ids: messageIds, properties: summaryProperties,
    }, "conversation-emails"]], [JMAP_MAIL]);
    const emailResult = client.result(
      emailResponse, "conversation-emails", "Email/get",
      jmapConversationGetResultSchema(jmapEmailSchema, MAX_CONVERSATION_MESSAGES),
    );
    const requested = new Set(messageIds);
    const returned = new Set(emailResult.list.map(({ id }) => id));
    if (emailResult.accountId !== accountId || emailResult.notFound.length !== 0 ||
        returned.size !== emailResult.list.length || returned.size !== requested.size ||
        emailResult.list.some((email) =>
          !requested.has(email.id) || email.threadId !== anchor.threadId) ||
        messageIds.some((messageId) => !returned.has(messageId))) throw loadError();

    const summaries = emailResult.list.slice().sort((left, right) => {
      const difference = receivedTime(left.receivedAt) - receivedTime(right.receivedAt);
      if (difference) return difference;
      return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
    }).map(mapMessageSummary);
    const snapshot = conversationSnapshot(summaries);
    assertConversationSnapshot(position.snapshot, snapshot);
    const items = summaries.slice(position.offset, position.offset + query.limit);
    const nextPosition = position.offset + items.length;
    return {
      anchorMessageId: query.anchorMessageId,
      items,
      nextCursor: nextConversationProviderCursor(
        nextPosition, summaries.length, snapshot,
      ),
      strategy: "native",
      total: summaries.length,
      truncated: membership.length > MAX_CONVERSATION_MESSAGES,
    };
  } catch {
    throw loadError();
  }
};
