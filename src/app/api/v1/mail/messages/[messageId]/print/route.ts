import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { createConnectionMessagePrintDocument } from "@/server/mail/message-print";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { messagePrintRequestSchema } from "@/transport/http/message-print.schema";
import { readJsonBody } from "@/transport/http/read-json-body";
import { replyMessageIdSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const POST = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mail-print", 500, 10, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mail-print", connection.id, 4, 60 * 1_000);
    const { messageId } = await context.params;
    const anchorMessageId = replyMessageIdSchema.parse(messageId);
    const input = messagePrintRequestSchema.parse(
      await readJsonBody(request, 1_024),
    );
    return apiSuccess(await createConnectionMessagePrintDocument(
      connection,
      anchorMessageId,
      input.scope,
    ));
  } catch (error) {
    return apiFailure(error, "Unable to prepare this print view.");
  }
};
