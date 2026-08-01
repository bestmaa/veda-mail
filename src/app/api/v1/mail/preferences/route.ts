import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { getMailService } from "@/server/mail/mail-service";
import { mailboxOwner } from "@/server/mailboxes/mailbox-http";
import { messageListPreferencesStore } from "@/server/preferences/message-list-preferences.store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { messageListPreferencesSchema } from "@/transport/http/message-list-preferences.schema";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 1_024;

export const PATCH = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "message-list-preferences", 5_000, 300, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "message-list-preferences", connection.id, 30, 15 * 60_000,
    );
    const preferences = messageListPreferencesSchema.parse(
      await readJsonBody(request, MAX_REQUEST_BYTES),
    );
    const owner = await mailboxOwner(await getMailService(connection));
    return apiSuccess({
      preferences: await messageListPreferencesStore.set(owner, preferences),
    });
  } catch (error) {
    return apiFailure(error, "Unable to save message list preferences.");
  }
};
