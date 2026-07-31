import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { asAttachmentDownloadApiError } from "@/server/mail/attachment-download-http";
import { prepareInlineImage } from "@/server/mail/inline-image";
import {
  createInlineImageResponse,
  inlineImageFailure,
  inlineImageMethodNotAllowed,
  parseInlineImageRequest,
  parseInlineImageRouteParams,
} from "@/server/mail/inline-image-http";
import { attachmentScanner } from "@/server/mail/attachment-service";
import { getMailService } from "@/server/mail/mail-service";
import { MagicNumberMimeDetector } from "@/server/security/attachment-inspection";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{
    readonly attachmentId: string;
    readonly messageId: string;
  }>;
}

const assertExplicitSameOriginRequest = (request: Request): void => {
  assertSameOrigin(request);
  if (
    !request.headers.get("origin") &&
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    throw new ApiError(
      "A same-origin inline image request is required.",
      "INVALID_REQUEST_ORIGIN",
      403,
    );
  }
};

const rejectRangeRequest = (request: Request): void => {
  if (!request.headers.has("range")) return;
  throw new ApiError(
    "Inline image byte-range requests are not supported.",
    "ATTACHMENT_RANGE_NOT_SATISFIABLE",
    416,
  );
};

export const POST = async (request: Request, context: RouteContext) => {
  try {
    assertExplicitSameOriginRequest(request);
    assertRequestRateLimit(
      request,
      "inline-image",
      2_000,
      120,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "inline-image",
      connection.id,
      60,
      60 * 1_000,
    );
    rejectRangeRequest(request);
    if (new URL(request.url).search) {
      throw new ApiError(
        "Inline image query parameters are not supported.",
        "INVALID_INLINE_IMAGE",
        400,
      );
    }
    const params = parseInlineImageRouteParams(await context.params);
    parseInlineImageRequest(await readJsonBody(request, 64));
    try {
      const mail = await getMailService(connection);
      const image = await prepareInlineImage(
        {
          attachmentId: id.attachment(params.attachmentId),
          messageId: id.message(params.messageId),
          signal: request.signal,
          subject: connection.id,
        },
        {
          download: (input) => mail.downloadAttachment(input),
          mimeDetector: new MagicNumberMimeDetector(),
          scanner: attachmentScanner(),
        },
      );
      return createInlineImageResponse(image, request.signal);
    } catch (error) {
      throw asAttachmentDownloadApiError(error);
    }
  } catch (error) {
    return inlineImageFailure(error);
  }
};

export const GET = inlineImageMethodNotAllowed;
export const HEAD = inlineImageMethodNotAllowed;
