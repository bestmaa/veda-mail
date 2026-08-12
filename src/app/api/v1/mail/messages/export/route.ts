import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { acquireAttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import {
  prepareMessageSourceArchive,
} from "@/server/mail/message-source-archive";
import { parseMessageSourceArchiveRequest } from "@/server/mail/message-source-archive-http";
import { getMailService } from "@/server/mail/mail-service";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { appendSecurityAudit, memberAuditActor } from "@/server/security-audit/security-audit";
import { apiFailure } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  let lease: ReturnType<typeof acquireAttachmentDownloadLease> | undefined;
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "message-source-archive", 10_000, 30, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("message-source-archive", connection.id, 10, 15 * 60_000);
    const { messageIds } = await parseMessageSourceArchiveRequest(request);
    lease = acquireAttachmentDownloadLease(connection.id);
    body = await prepareMessageSourceArchive({
      lease,
      mail: await getMailService(connection),
      messageIds,
      requestSignal: request.signal,
    });
    lease = undefined;
    await appendSecurityAudit({
      action: "member.message.exported", actor: memberAuditActor(connection),
      count: messageIds.length, outcome: "success", targetType: "messages",
    });
    const response = new Response(body, { headers: {
      "Cache-Control": "private, no-store, no-transform",
      "Content-Disposition": 'attachment; filename="veda-mail-messages.zip"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    } });
    body = undefined;
    return response;
  } catch (error) {
    void body?.cancel(error).catch(() => undefined);
    lease?.release();
    return apiFailure(error, "Unable to export selected messages.");
  }
};
