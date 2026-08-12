import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  acquireAttachmentArchiveLease,
} from "@/server/mail/attachment-archive-concurrency";
import {
  assertAttachmentArchiveRequest,
  attachmentArchiveFailure,
  createAttachmentArchiveResponse,
  parseAttachmentArchiveRouteParams,
} from "@/server/mail/attachment-archive-http";
import {
  preflightAttachmentArchive,
  prepareAttachmentArchive,
} from "@/server/mail/attachment-archive";
import {
  consumeAttachmentArchiveTicket,
  issueAttachmentArchiveTicket,
} from "@/server/mail/attachment-archive-ticket";
import { attachmentDownloadHeaders } from "@/server/mail/attachment-download-http";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";
const ARCHIVE_TICKET_QUERY = "ticket";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "attachment-archive",
      200,
      10,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    await assertAttachmentArchiveRequest(request, ARCHIVE_TICKET_QUERY);
    await assertSubjectRateLimit("attachment-archive", connection.id, 5, 60 * 1_000);
    const params = parseAttachmentArchiveRouteParams(await context.params);
    const ticket = new URL(request.url).searchParams.get(ARCHIVE_TICKET_QUERY);
    if (!ticket) {
      throw new ApiError(
        "A valid attachment archive ticket is required.",
        "ATTACHMENT_ARCHIVE_TICKET_REQUIRED",
        403,
      );
    }
    lease = acquireAttachmentArchiveLease(connection.id);
    consumeAttachmentArchiveTicket({
      connectionId: connection.id,
      messageId: params.messageId,
      ticket,
    });
    const mail = await getMailService(connection);
    body = await prepareAttachmentArchive({
      connectionId: connection.id,
      lease,
      mail,
      messageId: id.message(params.messageId),
      requestSignal: request.signal,
    });
    const response = createAttachmentArchiveResponse(body);
    lease = undefined;
    body = undefined;
    return response;
  } catch (error) {
    void body?.cancel(error).catch(() => undefined);
    lease?.release();
    return attachmentArchiveFailure(error);
  }
};

export const POST = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "attachment-archive-preflight",
      300,
      20,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "attachment-archive-preflight",
      connection.id,
      10,
      60 * 1_000,
    );
    await assertAttachmentArchiveRequest(request);
    const params = parseAttachmentArchiveRouteParams(await context.params);
    const mail = await getMailService(connection);
    lease = acquireAttachmentArchiveLease(connection.id);
    await preflightAttachmentArchive({
      mail,
      messageId: id.message(params.messageId),
      requestSignal: request.signal,
    });
    const issued = issueAttachmentArchiveTicket({
      connectionId: connection.id,
      messageId: params.messageId,
    });
    const response = apiSuccess(issued, { status: 201 });
    for (const [name, value] of attachmentDownloadHeaders()) {
      response.headers.set(name, value);
    }
    return response;
  } catch (error) {
    return attachmentArchiveFailure(error);
  } finally {
    lease?.release();
  }
};
