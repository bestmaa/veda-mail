import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { scheduledMessageOwner } from "@/server/scheduled-send/scheduled-send-http";
import { scheduledSendStore } from "@/server/scheduled-send/scheduled-send-store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import {
  rescheduleMessageSchema,
  scheduledMessageIdSchema,
} from "@/transport/http/scheduled-send.schema";

export const runtime = "nodejs";
interface RouteContext {
  readonly params: Promise<{ readonly scheduledMessageId: string }>;
}

const contextFor = async (request: Request, context: RouteContext) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  const params = await context.params;
  return {
    connection,
    messageId: scheduledMessageIdSchema.parse(params.scheduledMessageId),
    owner: await scheduledMessageOwner(connection),
  };
};

const limit = async (
  request: Request,
  connectionId: string,
): Promise<void> => {
  await assertRequestRateLimit(
    request,
    "scheduled-send-write",
    5_000,
    300,
    60_000,
  );
  await assertSubjectRateLimit(
    "scheduled-send-write",
    connectionId,
    30,
    60_000,
  );
};

export const PATCH = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    const current = await contextFor(request, context);
    await limit(request, current.connection.id);
    const input = rescheduleMessageSchema.parse(await readJsonBody(request));
    return apiSuccess(await scheduledSendStore.reschedule(
      current.owner, current.messageId, input.scheduledAt, current.connection,
    ));
  } catch (error) {
    return apiFailure(error, "Unable to reschedule this message.");
  }
};

export const DELETE = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    const current = await contextFor(request, context);
    await limit(request, current.connection.id);
    await scheduledSendStore.cancel(current.owner, current.messageId);
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store" },
      status: 204,
    });
  } catch (error) {
    return apiFailure(error, "Unable to cancel this scheduled message.");
  }
};
