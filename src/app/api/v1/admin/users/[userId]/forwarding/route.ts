import type { InstallationRecord } from "@/domain/installation/installation";
import {
  ADMIN_COOKIE, ADMIN_SESSION_TTL_SECONDS, adminCookieOptions,
  assertAdminAccess, issueAdminToken,
} from "@/server/auth/admin-session";
import { verifyAdminStepUp } from "@/server/auth/admin-step-up";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  getMailForwardingSnapshot, removeMailForwarding, setMailForwarding,
} from "@/server/mail-forwarding/mail-forwarding.service";
import {
  mailForwardingDeleteSchema, mailForwardingPutSchema,
} from "@/server/mail-forwarding/mail-forwarding.schema";
import { getAdminMailUser } from "@/server/mail-users/mail-user-administration";
import {
  adminMailUserDetailQuerySchema, adminMailUserIdSchema,
  parseAdminMailUserDetailSearchParams,
} from "@/server/mail-users/admin-mail-user.schema";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { administratorAuditActor, auditTargetId } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
const MAX_BODY = 8 * 1_024;
interface RouteContext { readonly params: Promise<{ readonly userId: string }> }

const mailbox = async (request: Request, context: RouteContext) => {
  const { domain } = adminMailUserDetailQuerySchema.parse(
    parseAdminMailUserDetailSearchParams(request.url),
  );
  const userId = adminMailUserIdSchema.parse((await context.params).userId);
  return getAdminMailUser(domain, userId);
};
const refresh = async (response: ReturnType<typeof apiSuccess> | ReturnType<typeof apiFailure>, installation: InstallationRecord | null) => {
  if (installation) response.cookies.set(
    ADMIN_COOKIE, await issueAdminToken(installation),
    { ...adminCookieOptions, maxAge: ADMIN_SESSION_TTL_SECONDS },
  );
  return response;
};

export const GET = async (request: Request, context: RouteContext) => {
  try {
    await assertAdminAccess();
    await assertRequestRateLimit(request, "admin-mail-forwarding-read", 5_000, 240, 60_000);
    await assertSubjectRateLimit("admin-mail-forwarding-read", "administrator", 240, 60_000);
    const user = await mailbox(request, context);
    return apiSuccess(await getMailForwardingSnapshot(user.email));
  } catch (error) { return apiFailure(error, "Unable to load mail forwarding."); }
};

const write = async (request: Request, context: RouteContext, remove: boolean) => {
  let rotated: InstallationRecord | null = null;
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    await assertRequestRateLimit(request, "admin-mail-forwarding-write", 200, 20, 15 * 60_000);
    await assertSubjectRateLimit("admin-mail-forwarding-write", "administrator", 10, 30 * 60_000);
    const body = await readJsonBody(request, MAX_BODY);
    const input = remove
      ? mailForwardingDeleteSchema.parse(body)
      : mailForwardingPutSchema.parse(body);
    const stepUp = await verifyAdminStepUp({
      currentPassword: input.currentAdminPassword,
      ...(input.otpCode ? { otpCode: input.otpCode } : {}),
    });
    if (stepUp.sessionRotated) rotated = stepUp.installation;
    const user = await mailbox(request, context);
    audit = securityAuditOperation({
      action: remove ? "admin.mail-forwarding.disabled" : "admin.mail-forwarding.enabled",
      actor: administratorAuditActor(stepUp.installation.owner.username),
      targetId: auditTargetId("user", user.email), targetType: "forwarding",
    });
    await audit.attempt();
    const ledger = remove
        ? await removeMailForwarding(user.email, input.expectedRevision)
      : await setMailForwarding(
          user.email,
          [user.email, ...user.aliases],
          mailForwardingPutSchema.parse(body).destinationEmail,
          input.expectedRevision,
        );
    audit.applied(); await audit.success();
    const configuration = ledger.entries.find((entry) => entry.sourceEmail.toLowerCase() === user.email.toLowerCase()) ?? null;
    return refresh(apiSuccess({ availability: "available", configuration, reason: null, revision: ledger.revision }), rotated);
  } catch (error) {
    await audit?.failureIfPending();
    return refresh(apiFailure(error, remove ? "Unable to disable forwarding." : "Unable to enable forwarding."), rotated);
  }
};

export const PUT = (request: Request, context: RouteContext) => write(request, context, false);
export const DELETE = (request: Request, context: RouteContext) => write(request, context, true);
