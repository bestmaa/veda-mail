import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
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
import { attachmentDownloadHeaders } from "@/server/mail/attachment-download-http";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "attachment-archive",
      200,
      10,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertSubjectRateLimit(
      "attachment-archive",
      connection.id,
      5,
      60 * 1_000,
    );
    assertAttachmentArchiveRequest(request);
    const params = parseAttachmentArchiveRouteParams(await context.params);
    const mail = await getMailService(connection);
    lease = acquireAttachmentArchiveLease(connection.id);
    body = await prepareAttachmentArchive({
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

export const HEAD = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "attachment-archive-preflight",
      300,
      20,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertSubjectRateLimit(
      "attachment-archive-preflight",
      connection.id,
      10,
      60 * 1_000,
    );
    assertAttachmentArchiveRequest(request);
    const params = parseAttachmentArchiveRouteParams(await context.params);
    const mail = await getMailService(connection);
    lease = acquireAttachmentArchiveLease(connection.id);
    await preflightAttachmentArchive({
      mail,
      messageId: id.message(params.messageId),
      requestSignal: request.signal,
    });
    return new Response(null, {
      headers: attachmentDownloadHeaders(),
      status: 204,
    });
  } catch (error) {
    const failure = attachmentArchiveFailure(error);
    return new Response(null, {
      headers: failure.headers,
      status: failure.status,
      statusText: failure.statusText,
    });
  } finally {
    lease?.release();
  }
};
