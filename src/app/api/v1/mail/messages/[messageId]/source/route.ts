import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import {
  createMessageSourceResponse,
  messageSourceFailure,
  parseMessageSourceParams,
} from "@/server/mail/message-source-download-http";
import { getMailService } from "@/server/mail/mail-service";
import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES } from "@/domain/mail/message-source";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { appendSecurityAudit, memberAuditActor } from "@/server/security-audit/security-audit";
import { ApiError } from "@/transport/http/api-error";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "message-source-export", 5_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("message-source-export", connection.id, 20, 15 * 60_000);
    if (request.headers.has("range")) {
      throw new ApiError("Message byte ranges are not supported.", "MESSAGE_RANGE_NOT_SATISFIABLE", 416);
    }
    const params = parseMessageSourceParams(await context.params);
    lease = acquireAttachmentDownloadLease(connection.id);
    const download = await (await getMailService(connection)).downloadMessageSource({
      maxBytes: MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
      messageId: id.message(params.messageId),
      signal: request.signal,
    });
    try {
      await appendSecurityAudit({
        action: "member.message.exported",
        actor: memberAuditActor(connection),
        count: 1,
        outcome: "success",
        targetType: "messages",
      });
    } catch (error) {
      await download.body.cancel(error).catch(() => undefined);
      throw error;
    }
    const response = createMessageSourceResponse(download, lease, request.signal);
    lease = undefined;
    return response;
  } catch (error) {
    lease?.release();
    return messageSourceFailure(error);
  }
};
