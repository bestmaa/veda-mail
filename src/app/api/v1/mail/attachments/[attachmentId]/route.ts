import { z } from "zod";

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
import { parseAttachmentContentLength } from "@/server/attachments";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly attachmentId: string }>;
}

const draftIdSchema = z
  .string()
  .uuid()
  .transform((value) => id.draft(value.toLowerCase()));

const draftIdFrom = (request: Request) =>
  draftIdSchema.parse(
    request.headers.get("x-veda-draft-id") ??
      new URL(request.url).searchParams.get("draftId"),
  );

const context = async (request: Request, route: RouteContext) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  assertSubjectRateLimit("attachment-transfer", connection.id, 120, 60 * 1000);
  const { attachmentId } = await route.params;
  return {
    attachmentId,
    connection,
    scope: attachmentScope(connection, draftIdFrom(request)),
  };
};

export const PUT = async (request: Request, route: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "attachment-upload", 500, 60, 60 * 1000);
    const current = await context(request, route);
    const contentLength = parseAttachmentContentLength(
      request.headers.get("content-length"),
    );
    await assertAttachmentCapability(current.connection, contentLength);
    if (!request.body) {
      throw new Error("Attachment body is missing.");
    }
    const uploaded = await attachmentService().upload(
      current.attachmentId,
      current.scope,
      request.body,
      contentLength,
    );
    return apiSuccess({
      expiresAt: uploaded.expiresAt,
      id: id.attachmentUpload(uploaded.id),
      mimeType: uploaded.detectedMimeType ?? "application/octet-stream",
      name: uploaded.fileName,
      size: uploaded.contentLength,
    });
  } catch (error) {
    void request.body?.cancel().catch(() => undefined);
    return apiFailure(
      asAttachmentApiError(error),
      "Unable to upload this attachment.",
    );
  }
};

export const DELETE = async (request: Request, route: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "attachment-remove", 2_000, 120, 60 * 1000);
    const current = await context(request, route);
    await attachmentService().remove(current.attachmentId, current.scope);
    return new Response(null, {
      headers: { "Cache-Control": "private, no-store" },
      status: 204,
    });
  } catch (error) {
    return apiFailure(
      asAttachmentApiError(error),
      "Unable to remove this attachment.",
    );
  }
};
