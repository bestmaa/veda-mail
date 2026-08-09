import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import type { MessageDetail } from "@/domain/mail/mail";
import {
  MAX_PRINT_CONVERSATION_MESSAGES,
  MAX_PRINT_CONVERSATION_PAGES,
  MESSAGE_PRINT_CONCURRENCY,
  type MessagePrintDocument,
  type MessagePrintScope,
  type PrintableMessage,
} from "@/domain/mail/message-print";
import type { MessageId } from "@/domain/shared/brand";
import type { ProviderConnection } from "@/domain/provider/provider";
import { sanitizeMailHtml } from "@/infrastructure/providers/sanitize-mail-html";
import { getMailService } from "@/server/mail/mail-service";

const printableMessage = (message: MessageDetail): PrintableMessage => ({
  attachments: message.attachments
    .filter(({ disposition }) => disposition === "attachment")
    .map(({ mimeType, name, size }) => ({ mimeType, name, size })),
  cc: message.cc,
  from: message.from,
  htmlBody: message.htmlBody ? sanitizeMailHtml(message.htmlBody) : null,
  id: message.id,
  receivedAt: message.receivedAt,
  replyTo: message.replyTo,
  size: message.size,
  subject: message.subject,
  textBody: message.textBody,
  to: message.to,
});

const mapConcurrent = async <TInput, TOutput>(
  items: readonly TInput[],
  operation: (item: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> => {
  const results = new Array<TOutput>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await operation(item);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MESSAGE_PRINT_CONCURRENCY, items.length) },
      () => worker(),
    ),
  );
  return results;
};

const loadConversationMessageIds = async (
  service: MailApplicationService,
  anchorMessageId: MessageId,
): Promise<{
  readonly ids: readonly MessageId[];
  readonly total: number;
  readonly truncated: boolean;
}> => {
  const ids: MessageId[] = [];
  const seenIds = new Set<MessageId>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  let total = 0;
  let truncated = false;
  while (ids.length < MAX_PRINT_CONVERSATION_MESSAGES) {
    pageCount += 1;
    const page = await service.getConversation({
      anchorMessageId,
      ...(cursor ? { cursor } : {}),
      limit: CONVERSATION_PAGE_SIZE,
    });
    if (page.anchorMessageId !== anchorMessageId) {
      throw new Error("The provider returned a mismatched conversation anchor.");
    }
    total = Math.max(total, page.total);
    truncated ||= page.truncated;
    for (const item of page.items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      ids.push(item.id);
      if (ids.length === MAX_PRINT_CONVERSATION_MESSAGES) break;
    }
    if (!page.nextCursor) break;
    if (pageCount >= MAX_PRINT_CONVERSATION_PAGES) {
      truncated = true;
      break;
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("The provider repeated a conversation cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
    truncated ||= ids.length >= MAX_PRINT_CONVERSATION_MESSAGES;
  }
  if (!seenIds.has(anchorMessageId)) {
    throw new Error("The provider omitted the selected conversation message.");
  }
  return {
    ids,
    total: Math.max(total, ids.length),
    truncated: truncated || total > ids.length,
  };
};

export const createMessagePrintDocument = async (
  service: MailApplicationService,
  anchorMessageId: MessageId,
  scope: MessagePrintScope,
): Promise<MessagePrintDocument> => {
  if (scope === "message") {
    const message = await service.getMessage(anchorMessageId);
    if (message.id !== anchorMessageId) {
      throw new Error("The provider returned a mismatched message.");
    }
    return {
      anchorMessageId,
      messages: [printableMessage(message)],
      scope,
      total: 1,
      truncated: false,
    };
  }
  const conversation = await loadConversationMessageIds(
    service,
    anchorMessageId,
  );
  const messages = await mapConcurrent(conversation.ids, async (messageId) => {
    const message = await service.getMessage(messageId);
    if (message.id !== messageId) {
      throw new Error("The provider returned a mismatched message.");
    }
    return printableMessage(message);
  });
  return {
    anchorMessageId,
    messages,
    scope,
    total: conversation.total,
    truncated: conversation.truncated,
  };
};

export const createConnectionMessagePrintDocument = async (
  connection: ProviderConnection,
  anchorMessageId: MessageId,
  scope: MessagePrintScope,
): Promise<MessagePrintDocument> => createMessagePrintDocument(
  await getMailService(connection),
  anchorMessageId,
  scope,
);
