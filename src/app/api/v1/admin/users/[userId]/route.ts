import { assertAdminAccess } from "@/server/auth/admin-session";
import { getAdminMailUser } from "@/server/mail-users/mail-user-administration";
import {
  adminMailUserDetailQuerySchema,
  adminMailUserIdSchema,
  parseStrictSearchParams,
} from "@/server/mail-users/admin-mail-user.schema";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly userId: string }>;
}

export const GET = async (request: Request, context: RouteContext) => {
  try {
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-mail-user-detail",
      5_000,
      300,
      60 * 1_000,
    );
    assertSubjectRateLimit(
      "admin-mail-user-detail",
      "administrator",
      300,
      60 * 1_000,
    );
    const { domain } = adminMailUserDetailQuerySchema.parse(
      parseStrictSearchParams(request.url),
    );
    const { userId: rawUserId } = await context.params;
    const userId = adminMailUserIdSchema.parse(rawUserId);
    return apiSuccess({ user: await getAdminMailUser(domain, userId) });
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox user.");
  }
};
