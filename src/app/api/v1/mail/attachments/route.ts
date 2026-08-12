import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asAttachmentApiError,
  assertAttachmentCapability,
  attachmentScope,
  attachmentService,
} from "@/server/mail/attachment-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { attachmentReservationSchema } from "@/transport/http/request-schemas";
import {
  assertAttachmentFilePolicy,
  getMailContentPolicy,
} from "@/server/organization/mail-content-policy.service";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(
      request,
      "attachment-reserve",
      2_000,
      120,
      60 * 1000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("attachment-reserve", connection.id, 30, 60 * 1000);
    const input = attachmentReservationSchema.parse(
      await readJsonBody(request, 16 * 1024),
    );
    assertAttachmentFilePolicy(await getMailContentPolicy(), {
      name: input.fileName,
      size: input.size,
    });
    await assertAttachmentCapability(connection, input.size);
    const attachment = await attachmentService().reserve({
      contentLength: input.size,
      declaredMimeType: input.declaredMimeType,
      fileName: input.fileName,
      scope: attachmentScope(connection, input.draftId),
    });
    return apiSuccess(
      {
        id: id.attachmentUpload(attachment.id),
        uploadUrl: `/api/v1/mail/attachments/${encodeURIComponent(
          attachment.id,
        )}`,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(
      asAttachmentApiError(error),
      "Unable to reserve this attachment.",
    );
  }
};
