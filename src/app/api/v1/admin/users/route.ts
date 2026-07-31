import type { InstallationRecord } from "@/domain/installation/installation";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  assertAdminAccess,
  issueAdminToken,
} from "@/server/auth/admin-session";
import { verifyAdminStepUp } from "@/server/auth/admin-step-up";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { getAdminMailUsersSnapshot } from "@/server/mail-users/mail-user-administration";
import {
  adminMailUserCreateSchema,
  adminMailUserIdempotencyKeySchema,
  adminMailUserListQuerySchema,
  parseStrictSearchParams,
} from "@/server/mail-users/admin-mail-user.schema";
import { provisionAdminMailUser } from "@/server/mail-users/mail-user-provisioning";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_ADMIN_MAIL_USER_BODY_BYTES = 16 * 1024;

const refreshAdminSession = async (
  response: ReturnType<typeof apiSuccess> | ReturnType<typeof apiFailure>,
  installation: InstallationRecord | null,
) => {
  if (installation) {
    response.cookies.set(
      ADMIN_COOKIE,
      await issueAdminToken(installation),
      { ...adminCookieOptions, maxAge: ADMIN_SESSION_TTL_SECONDS },
    );
  }
  return response;
};

export const GET = async (request: Request) => {
  try {
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-mail-users-read",
      5_000,
      300,
      60 * 1_000,
    );
    assertSubjectRateLimit(
      "admin-mail-users-read",
      "administrator",
      300,
      60 * 1_000,
    );
    const query = adminMailUserListQuerySchema.parse(
      parseStrictSearchParams(request.url),
    );
    return apiSuccess(
      await getAdminMailUsersSnapshot({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.domain ? { domain: query.domain } : {}),
        ...(query.search ? { search: query.search } : {}),
      }),
    );
  } catch (error) {
    return apiFailure(error, "Unable to load mailbox users.");
  }
};

export const POST = async (request: Request) => {
  let refreshedInstallation: InstallationRecord | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-mail-user-create",
      200,
      20,
      15 * 60 * 1_000,
    );
    assertSubjectRateLimit(
      "admin-mail-user-create",
      "administrator",
      10,
      30 * 60 * 1_000,
    );
    const idempotencyKey = adminMailUserIdempotencyKeySchema.parse(
      request.headers.get("idempotency-key"),
    );
    const input = adminMailUserCreateSchema.parse(
      await readJsonBody(request, MAX_ADMIN_MAIL_USER_BODY_BYTES),
    );
    const stepUp = await verifyAdminStepUp({
      currentPassword: input.currentAdminPassword,
      ...(input.otpCode ? { otpCode: input.otpCode } : {}),
    });
    if (stepUp.sessionRotated) refreshedInstallation = stepUp.installation;
    const result = await provisionAdminMailUser(
      idempotencyKey,
      {
        ...(input.displayName ? { displayName: input.displayName } : {}),
        email: input.email,
        password: input.password,
      },
      stepUp.installation.sessionSecret,
      mailServiceProfileRevision(stepUp.installation.mailProfile),
    );
    return refreshAdminSession(
      apiSuccess(
        {
          replayed: result.replayed === true,
          user: result.user,
          ...(result.warning
            ? { warning: result.warning }
            : {}),
        },
        { status: result.replayed ? 200 : 201 },
      ),
      refreshedInstallation,
    );
  } catch (error) {
    return refreshAdminSession(
      apiFailure(error, "Unable to create this mailbox user."),
      refreshedInstallation,
    );
  }
};
