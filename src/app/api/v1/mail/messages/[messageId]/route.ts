import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import { labelHttpError } from "@/server/labels/label-http";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { messageMutationSchema } from "@/transport/http/request-schemas";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly messageId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  try {
    assertRequestRateLimit(request, "mail-read", 20_000, 1_000, 60 * 1000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mail-read", connection.id, 300, 60 * 1000);
    const { messageId } = await context.params;
    const message = await (
      await getMailService(connection)
    ).getMessage(id.message(messageId));
    return apiSuccess(message);
  } catch (error) {
    return apiFailure(error, "Unable to open this message.");
  }
};

export const PATCH = async (request: Request, context: RouteContext) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mail-mutation", 5_000, 300, 60 * 1000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("mail-mutation", connection.id, 120, 60 * 1000);
    const { messageId } = await context.params;
    const payload = await readJsonBody(request, 32 * 1024);
    const mutation = messageMutationSchema.parse({
      ...(typeof payload === "object" && payload ? payload : {}),
      messageId,
    });
    const service = await getMailService(connection);
    if (mutation.type === "set-label") {
      await labelCatalogStore.requireActive(
        await mailboxOwner(service),
        mutation.labelId,
      );
    }
    await service.mutateMessage(mutation);
    return apiSuccess({ updated: true });
  } catch (error) {
    return apiFailure(labelHttpError(error), "Unable to update this message.");
  }
};
