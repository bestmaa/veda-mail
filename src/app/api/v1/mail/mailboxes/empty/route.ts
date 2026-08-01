import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import { emptyMailboxBatch } from "@/server/mailboxes/mailbox-empty.service";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { emptyMailboxSchema } from "@/transport/http/mailbox-empty.schema";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 8 * 1_024;

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "mailbox-empty", 10_000, 600, 60 * 1_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "mailbox-empty",
      connection.id,
      600,
      15 * 60 * 1_000,
    );
    const payload = emptyMailboxSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    const service = await getMailService(connection);
    const update = await emptyMailboxBatch(
      service,
      await mailboxOwner(service),
      payload.mailboxId,
    );
    return apiSuccess(update, { status: update.complete ? 200 : 202 });
  } catch (error) {
    return apiFailure(error, "Unable to empty this mailbox.");
  }
};
