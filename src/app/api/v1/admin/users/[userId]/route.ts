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
import { getAdminMailUser } from "@/server/mail-users/mail-user-administration";
import { executeMailUserLifecycle } from "@/server/mail-users/mail-user-lifecycle";
import {
  adminMailUserDetailQuerySchema,
  adminMailUserIdSchema,
  adminMailUserIdempotencyKeySchema,
  adminMailUserLifecycleSchema,
  parseAdminMailUserDetailSearchParams,
} from "@/server/mail-users/admin-mail-user.schema";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  administratorAuditActor,
  auditTargetId,
} from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ readonly userId: string }>;
}

const MAX_BODY_BYTES = 8 * 1_024;

const parsedTarget = async (request: Request, context: RouteContext) => {
  const { domain } = adminMailUserDetailQuerySchema.parse(
    parseAdminMailUserDetailSearchParams(request.url),
  );
  const { userId: rawUserId } = await context.params;
  return { domain, userId: adminMailUserIdSchema.parse(rawUserId) };
};

const refresh = async (
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

export const GET = async (request: Request, context: RouteContext) => {
  try {
    await assertAdminAccess();
    await assertRequestRateLimit(
      request,
      "admin-mail-user-detail",
      5_000,
      300,
      60 * 1_000,
    );
    await assertSubjectRateLimit(
      "admin-mail-user-detail",
      "administrator",
      300,
      60 * 1_000,
    );
    const { domain, userId } = await parsedTarget(request, context);
    return apiSuccess({ user: await getAdminMailUser(domain, userId) });
  } catch (error) {
    return apiFailure(error, "Unable to load this mailbox user.");
  }
};

const lifecycle = async (
  request: Request,
  context: RouteContext,
  operation: "disable" | "delete",
) => {
  let rotated: InstallationRecord | null = null;
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    await assertRequestRateLimit(
      request,
      "admin-mail-user-lifecycle",
      200,
      12,
      30 * 60 * 1_000,
    );
    await assertSubjectRateLimit(
      "admin-mail-user-lifecycle",
      "administrator",
      6,
      30 * 60 * 1_000,
    );
    const idempotencyKey = adminMailUserIdempotencyKeySchema.parse(
      request.headers.get("idempotency-key"),
    );
    const input = adminMailUserLifecycleSchema.parse(
      await readJsonBody(request, MAX_BODY_BYTES),
    );
    const stepUp = await verifyAdminStepUp({
      currentPassword: input.currentAdminPassword,
      ...(input.otpCode ? { otpCode: input.otpCode } : {}),
    });
    if (stepUp.sessionRotated) rotated = stepUp.installation;
    const target = await parsedTarget(request, context);
    const email = input.confirmationEmail;
    audit = securityAuditOperation({
      action: operation === "delete"
        ? "admin.mail-user.deleted"
        : "admin.mail-user.disabled",
      actor: administratorAuditActor(stepUp.installation.owner.username),
      targetId: auditTargetId("user", email),
      targetType: "user",
    });
    await audit.attempt();
    const result = await executeMailUserLifecycle(
      idempotencyKey,
      { ...target, email, operation },
      stepUp.installation.sessionSecret,
      mailServiceProfileRevision(stepUp.installation.mailProfile),
      () => audit?.applied(),
    );
    audit.applied();
    await audit.success(result.sessionsRevoked);
    return refresh(apiSuccess({ ...result, replayed: result.replayed === true }), rotated);
  } catch (error) {
    await audit?.failureIfPending();
    return refresh(
      apiFailure(
        error,
        operation === "delete"
          ? "Unable to delete this mailbox."
          : "Unable to disable this mailbox.",
      ),
      rotated,
    );
  }
};

export const PATCH = (request: Request, context: RouteContext) =>
  lifecycle(request, context, "disable");

export const DELETE = (request: Request, context: RouteContext) =>
  lifecycle(request, context, "delete");
