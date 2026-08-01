import { id } from "@/domain/shared/brand";
import { connectionExpiresAt } from "@/server/connections/connection-lifetime";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import {
  assertMailSessionScope,
  MAIL_SESSION_SCOPE_HEADER,
  mailSessionScope,
} from "@/server/connections/mail-session-scope";
import { getMailService } from "@/server/mail/mail-service";
import { decorateMailboxesSafely } from "@/server/mailboxes/mailbox-http";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { ApiError } from "@/transport/http/api-error";

export const runtime = "nodejs";

const parseMessageCursor = (value: string | null): string | undefined => {
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d{0,9})$/.test(value)) {
    throw new ApiError("The mailbox cursor is invalid.", "INVALID_CURSOR", 400);
  }
  const position = Number(value);
  if (!Number.isSafeInteger(position) || position > 2_147_483_647) {
    throw new ApiError("The mailbox cursor is invalid.", "INVALID_CURSOR", 400);
  }
  return String(position);
};

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
    const cursor = parseMessageCursor(params.get("cursor"));
    const search = params.get("search");
    const workspace = await (await getMailService(connection)).getWorkspace({
      ...(cursor ? { cursor } : {}),
      limit: 50,
      ...(mailbox ? { mailboxId: id.mailbox(mailbox) } : {}),
      ...(search ? { search: search.slice(0, 200) } : {}),
    });
    const mailboxes = await decorateMailboxesSafely(
      { email: workspace.account.email, providerId: workspace.account.providerId },
      workspace.mailboxes,
    );
    if (!connectionStore.isActive(connection)) {
      throw new ApiError(
        "This mail connection expired. Connect the account again.",
        "MEMBER_SESSION_EXPIRED",
        401,
      );
    }
    return apiSuccess({
      ...workspace,
      mailboxes,
      sessionExpiresAt: connectionExpiresAt(connection),
      sessionScope: mailSessionScope(connection),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox.");
  }
};
