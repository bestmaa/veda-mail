import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  conversationCursorSecret,
  decodeConversationCursor,
  encodeConversationCursor,
} from "@/server/mail/conversation-cursor";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { parseConversationQuery } from "@/transport/http/conversation-query";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  try {
    await assertRequestRateLimit(
      request, "mail-conversation", 2_000, 120, 60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "mail-conversation", connection.id, 30, 60 * 1_000,
    );
    const { messageId } = await context.params;
    const query = parseConversationQuery(request, messageId);
    const secret = await conversationCursorSecret(connection.id);
    const providerCursor = query.cursor
      ? decodeConversationCursor(query.cursor, query.anchorMessageId, secret)
      : undefined;
    const page = await (
      await getMailService(connection)
    ).getConversation({
      anchorMessageId: query.anchorMessageId,
      ...(providerCursor ? { cursor: providerCursor } : {}),
      limit: CONVERSATION_PAGE_SIZE,
    });
    const nextCursor = page.nextCursor
      ? encodeConversationCursor(
          page.nextCursor,
          query.anchorMessageId,
          secret,
        )
      : null;
    return apiSuccess({ ...page, nextCursor });
  } catch (error) {
    return apiFailure(error, "Unable to load this conversation.");
  }
};
