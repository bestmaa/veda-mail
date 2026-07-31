import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asAttachmentImportApiError,
} from "@/server/mail/attachment-import";
import { importOriginalAttachment } from "@/server/mail/attachment-original-import";
import { parseAttachmentDownloadRouteParams } from "@/server/mail/attachment-download-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { attachmentImportSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{
    readonly attachmentId: string;
    readonly messageId: string;
  }>;
}

export const POST = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "attachment-import",
      1_000,
      60,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("attachment-import", connection.id, 20, 60 * 1_000);
    const input = attachmentImportSchema.parse(
      await readJsonBody(request, 4 * 1_024),
    );
    const params = parseAttachmentDownloadRouteParams(await context.params);
    const imported = await importOriginalAttachment({
      attachmentId: id.attachment(params.attachmentId),
      connection,
      draftId: input.draftId,
      messageId: id.message(params.messageId),
      signal: request.signal,
    });
    return apiSuccess(
      {
        expiresAt: imported.expiresAt,
        id: id.attachmentUpload(imported.id),
        mimeType: imported.detectedMimeType ?? "application/octet-stream",
        name: imported.fileName,
        size: imported.contentLength,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(
      asAttachmentImportApiError(error),
      "Unable to forward this attachment.",
    );
  }
};
