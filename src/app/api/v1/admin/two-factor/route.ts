import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  assertAdminAccess,
  issueAdminToken,
} from "@/server/auth/admin-session";
import { isAdminRecoveryConfigured } from "@/server/auth/admin-recovery";
import {
  adminTwoFactorEnrollmentStore,
  verifyAdminSecondFactor,
} from "@/server/auth/admin-two-factor";
import { installationStore } from "@/server/installation/installation.store";
import {
  adminTwoFactorConfirmSchema,
  adminTwoFactorDisableSchema,
} from "@/server/installation/installation.schema";
import { verifyAdminPasswordDigest } from "@/server/installation/password-hash";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { installationAdministratorAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_TWO_FACTOR_BODY_BYTES = 16 * 1024;

const currentInstallation = async () => {
  await assertAdminAccess();
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  return installation;
};

const setSession = async (
  response: ReturnType<typeof apiSuccess>,
  installation: Awaited<ReturnType<typeof currentInstallation>>,
) => {
  response.cookies.set(ADMIN_COOKIE, await issueAdminToken(installation), {
    ...adminCookieOptions,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  return response;
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    const installation = await currentInstallation();
    assertSubjectRateLimit(
      "admin-two-factor-start",
      String(installation.owner.authVersion),
      3,
      60 * 60 * 1_000,
    );
    if (!isAdminRecoveryConfigured()) {
      throw new ApiError(
        "Configure VEDA_MAIL_ADMIN_RECOVERY_TOKEN before enabling 2FA.",
        "ADMIN_RECOVERY_NOT_CONFIGURED",
        409,
      );
    }
    if (installation.owner.twoFactor) {
      throw new ApiError(
        "Administrator two-factor authentication is already enabled.",
        "TWO_FACTOR_ALREADY_ENABLED",
        409,
      );
    }
    const enrollment = await adminTwoFactorEnrollmentStore.create(
      installation.owner.authVersion,
      installation.owner.username,
      installation.organization.productName,
    );
    return apiSuccess({ enrollment }, { status: 201 });
  } catch (error) {
    return apiFailure(error, "Unable to start administrator 2FA setup.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const installation = await currentInstallation();
    assertSubjectRateLimit(
      "admin-two-factor-confirm",
      String(installation.owner.authVersion),
      8,
      15 * 60 * 1_000,
    );
    const input = adminTwoFactorConfirmSchema.parse(
      await readJsonBody(request, MAX_TWO_FACTOR_BODY_BYTES),
    );
    if (!isAdminRecoveryConfigured()) {
      throw new ApiError(
        "Configure VEDA_MAIL_ADMIN_RECOVERY_TOKEN before enabling 2FA.",
        "ADMIN_RECOVERY_NOT_CONFIGURED",
        409,
      );
    }
    if (
      !(await verifyAdminPasswordDigest(
        input.currentPassword,
        installation.owner.password,
      ))
    ) {
      throw new ApiError(
        "Current administrator password is incorrect.",
        "ADMIN_UNAUTHORIZED",
        401,
      );
    }
    const confirmed = adminTwoFactorEnrollmentStore.confirm(
      installation.owner.authVersion,
      installation.owner.username,
      input.otpCode,
      installation.sessionSecret,
    );
    if (!confirmed) {
      throw new ApiError(
        "That verification code is incorrect or setup expired.",
        "TWO_FACTOR_CODE_REJECTED",
        400,
      );
    }
    audit = securityAuditOperation({
      action: "admin.two-factor.enrolled",
      actor: installationAdministratorAuditActor(),
      targetType: "two-factor",
    });
    await audit.attempt();
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      {
        password: installation.owner.password,
        twoFactor: confirmed.twoFactor,
        username: installation.owner.username,
      },
    );
    audit.applied();
    await audit.success();
    return setSession(
      apiSuccess({
        enabled: true,
        recoveryCodes: confirmed.recoveryCodes,
      }),
      updated,
    );
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to enable administrator 2FA.");
  }
};

export const DELETE = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const installation = await currentInstallation();
    assertSubjectRateLimit(
      "admin-two-factor-disable",
      String(installation.owner.authVersion),
      5,
      15 * 60 * 1_000,
    );
    const input = adminTwoFactorDisableSchema.parse(
      await readJsonBody(request, MAX_TWO_FACTOR_BODY_BYTES),
    );
    if (
      !installation.owner.twoFactor ||
      !(await verifyAdminPasswordDigest(
        input.currentPassword,
        installation.owner.password,
      )) ||
      !verifyAdminSecondFactor(
        input.otpCode,
        installation.owner.twoFactor,
        installation.sessionSecret,
      ).valid
    ) {
      throw new ApiError(
        "Current password or verification code is incorrect.",
        "TWO_FACTOR_DISABLE_REJECTED",
        401,
      );
    }
    audit = securityAuditOperation({
      action: "admin.two-factor.disabled",
      actor: installationAdministratorAuditActor(),
      targetType: "two-factor",
    });
    await audit.attempt();
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      {
        password: installation.owner.password,
        twoFactor: null,
        username: installation.owner.username,
      },
    );
    audit.applied();
    await audit.success();
    adminTwoFactorEnrollmentStore.remove(
      installation.owner.authVersion,
      installation.owner.username,
    );
    return setSession(apiSuccess({ enabled: false }), updated);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to disable administrator 2FA.");
  }
};
