import { id } from "@/domain/shared/brand";
import { getCurrentConnection } from "@/server/connections/connection-session";
import {
  assertMailSessionScope,
  MAIL_SESSION_SCOPE_HEADER,
  mailSessionScope,
} from "@/server/connections/mail-session-scope";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(request, "mail-read", 20_000, 1_000, 60 * 1000);
    const connection = await getCurrentConnection();
    if (request.headers.has(MAIL_SESSION_SCOPE_HEADER)) {
      assertMailSessionScope(request, connection);
    }
    assertSubjectRateLimit("mail-read", connection.id, 300, 60 * 1000);
    const params = new URL(request.url).searchParams;
    const mailbox = params.get("mailboxId");
    const cursor = params.get("cursor");
    const search = params.get("search");
    const workspace = await (
      await getMailService(connection)
    ).getWorkspace({
      ...(cursor ? { cursor } : {}),
      limit: 50,
      ...(mailbox ? { mailboxId: id.mailbox(mailbox) } : {}),
      ...(search ? { search: search.slice(0, 200) } : {}),
    });
    return apiSuccess({
      ...workspace,
      sessionScope: mailSessionScope(connection),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox.");
  }
};
