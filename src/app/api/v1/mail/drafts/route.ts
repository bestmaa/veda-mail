import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asDraftApiError,
  canonicalizeDraftRequestContent,
} from "@/server/mail/draft-http";
import { saveDraftWithAttachments } from "@/server/mail/draft-attachment-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import {
  createDraftSchema,
} from "@/transport/http/draft-schemas";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_DRAFT_REQUEST_BYTES = 1024 * 1024;

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "mail-draft-write",
      10_000,
      600,
      60 * 1_000,
    );
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "mail-draft-write",
      connection.id,
      240,
      60 * 1_000,
    );
    const input = createDraftSchema.parse(
      await readJsonBody(request, MAX_DRAFT_REQUEST_BYTES),
    );
    assertMailSessionScope(request, connection);
    const draft = await saveDraftWithAttachments(
      connection,
      {
        composeId: input.composeId,
        content: canonicalizeDraftRequestContent(input.content),
      },
      input.attachmentIds,
    );
    return apiSuccess(draft, { status: 201 });
  } catch (error) {
    return apiFailure(
      asDraftApiError(error),
      "Unable to save this draft.",
    );
  }
};
