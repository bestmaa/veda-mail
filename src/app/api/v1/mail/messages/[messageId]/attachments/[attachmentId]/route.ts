import { id } from "@/domain/shared/brand";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type { AttachmentDownload } from "@/domain/mail/mail";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import {
  asAttachmentDownloadApiError,
  ATTACHMENT_DOWNLOAD_MAX_BYTES,
  attachmentDownloadFailure,
  createAttachmentDownloadResponse,
  parseAttachmentDownloadRouteParams,
} from "@/server/mail/attachment-download-http";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{
    readonly attachmentId: string;
    readonly messageId: string;
  }>;
}

const rejectRangeRequest = (request: Request): void => {
  if (!request.headers.has("range")) return;
  throw new ApiError(
    "Attachment byte-range requests are not supported.",
    "ATTACHMENT_RANGE_NOT_SATISFIABLE",
    416,
  );
};

export const GET = async (request: Request, context: RouteContext) => {
  let lease: AttachmentDownloadLease | undefined;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "attachment-download",
      2_000,
      120,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertSubjectRateLimit(
      "attachment-download",
      connection.id,
      60,
      60 * 1_000,
    );
    rejectRangeRequest(request);
    const params = parseAttachmentDownloadRouteParams(await context.params);
    lease = acquireAttachmentDownloadLease(connection.id);
    let download: AttachmentDownload;
    try {
      download = await (
        await getMailService(connection)
      ).downloadAttachment({
        attachmentId: id.attachment(params.attachmentId),
        maxBytes: ATTACHMENT_DOWNLOAD_MAX_BYTES,
        messageId: id.message(params.messageId),
        signal: request.signal,
      });
      const response = createAttachmentDownloadResponse(
        download,
        lease,
        request.signal,
      );
      lease = undefined;
      return response;
    } catch (error) {
      throw asAttachmentDownloadApiError(error);
    }
  } catch (error) {
    lease?.release();
    return attachmentDownloadFailure(
      error instanceof AttachmentDownloadError
        ? asAttachmentDownloadApiError(error)
        : error,
    );
  }
};
