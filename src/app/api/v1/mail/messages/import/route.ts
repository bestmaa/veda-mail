import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  asMessageSourceImportApiError,
  parseMessageSourceImportMailbox,
  readMessageSourceImportBody,
} from "@/server/mail/message-source-import-http";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  appendSecurityAudit,
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { ApiError } from "@/transport/http/api-error";

export const runtime = "nodejs";

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "message-source-import", 10_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("message-source-import", connection.id, 20, 15 * 60_000);
    const service = await getMailService(connection);
    const mailboxId = parseMessageSourceImportMailbox(request);
    const mailbox = (await service.listMailboxes()).find(({ id }) => id === mailboxId);
    if (!mailbox) throw new ApiError(
      "Destination mailbox was not found.", "MESSAGE_IMPORT_MAILBOX_NOT_FOUND", 404,
    );
    if (mailbox.rights.mayAddItems === false) throw new ApiError(
      "Destination mailbox does not accept messages.",
      "MESSAGE_IMPORT_MAILBOX_FORBIDDEN",
      403,
    );
    const result = await service.importMessageSource({
      mailboxId,
      signal: request.signal,
      source: await readMessageSourceImportBody(request),
    });
    await appendSecurityAudit({
      action: "member.message.imported",
      actor: memberAuditActor(connection),
      count: 1,
      outcome: "success",
      targetType: "messages",
    });
    return apiSuccess(result, { status: 201 });
  } catch (error) {
    return apiFailure(
      asMessageSourceImportApiError(error),
      "Unable to import this message.",
    );
  }
};
