import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asDraftApiError,
  canonicalizeDraftRequestContent,
} from "@/server/mail/draft-http";
import { getMailService } from "@/server/mail/mail-service";
import { saveDraftWithAttachments } from "@/server/mail/draft-attachment-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import {
  deleteDraftSchema,
  providerDraftIdSchema,
  updateDraftSchema,
} from "@/transport/http/draft-schemas";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_DRAFT_REQUEST_BYTES = 1024 * 1024;

interface RouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

const loadContext = async (request: Request, context: RouteContext) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  const { draftId } = await context.params;
  return {
    connection,
    providerDraftId: providerDraftIdSchema.parse(draftId),
  };
};

export const GET = async (request: Request, context: RouteContext) => {
  try {
    assertRequestRateLimit(
      request,
      "mail-draft-read",
      20_000,
      1_000,
      60 * 1_000,
    );
    const { connection, providerDraftId } = await loadContext(request, context);
    assertSubjectRateLimit(
      "mail-draft-read",
      connection.id,
      300,
      60 * 1_000,
    );
    const draft = await (
      await getMailService(connection)
    ).getDraft(providerDraftId);
    return apiSuccess(draft);
  } catch (error) {
    return apiFailure(asDraftApiError(error), "Unable to load this draft.");
  }
};

export const PUT = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "mail-draft-write",
      10_000,
      600,
      60 * 1_000,
    );
    const { connection, providerDraftId } = await loadContext(request, context);
    assertSubjectRateLimit(
      "mail-draft-write",
      connection.id,
      240,
      60 * 1_000,
    );
    const input = updateDraftSchema.parse(
      await readJsonBody(request, MAX_DRAFT_REQUEST_BYTES),
    );
    assertMailSessionScope(request, connection);
    const draft = await saveDraftWithAttachments(
      connection,
      {
        composeId: input.composeId,
        content: canonicalizeDraftRequestContent(input.content),
        expectedRevision: input.expectedRevision,
        providerDraftId,
        retainedAttachmentIds: input.retainedAttachmentIds,
      },
      input.attachmentIds,
    );
    return apiSuccess(draft);
  } catch (error) {
    return apiFailure(asDraftApiError(error), "Unable to update this draft.");
  }
};

export const DELETE = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "mail-draft-write",
      10_000,
      600,
      60 * 1_000,
    );
    const { connection, providerDraftId } = await loadContext(request, context);
    assertSubjectRateLimit(
      "mail-draft-write",
      connection.id,
      240,
      60 * 1_000,
    );
    const input = deleteDraftSchema.parse(
      await readJsonBody(request, MAX_DRAFT_REQUEST_BYTES),
    );
    await (
      await getMailService(connection)
    ).discardDraft(providerDraftId, input.expectedRevision);
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store" },
      status: 204,
    });
  } catch (error) {
    return apiFailure(asDraftApiError(error), "Unable to discard this draft.");
  }
};
