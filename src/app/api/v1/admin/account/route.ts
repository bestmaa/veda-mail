import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  assertAdminAccess,
  issueAdminToken,
} from "@/server/auth/admin-session";
import { isAdminRecoveryConfigured } from "@/server/auth/admin-recovery";
import {
  verifyAdminSecondFactor,
  withoutRecoveryCode,
} from "@/server/auth/admin-two-factor";
import {
  adminAccountUpdateSchema,
} from "@/server/installation/installation.schema";
import { installationStore } from "@/server/installation/installation.store";
import {
  hashAdminPassword,
  verifyAdminPasswordDigest,
} from "@/server/installation/password-hash";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { installationAdministratorAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_ADMIN_ACCOUNT_BODY_BYTES = 16 * 1024;

export const GET = async () => {
  try {
    await assertAdminAccess();
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
    }
    return apiSuccess({
      security: {
        recoveryCodesRemaining:
          installation.owner.twoFactor?.recoveryCodes.length ?? 0,
        recoveryConfigured: isAdminRecoveryConfigured(),
        twoFactorEnabled: installation.owner.twoFactor !== null,
      },
      username: installation.owner.username,
    });
  } catch (error) {
    return apiFailure(error, "Unable to load administrator account.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-account",
      500,
      50,
      30 * 60 * 1000,
    );
    assertSubjectRateLimit(
      "admin-account",
      "administrator",
      8,
      30 * 60 * 1000,
    );
    const input = adminAccountUpdateSchema.parse(
      await readJsonBody(request, MAX_ADMIN_ACCOUNT_BODY_BYTES),
    );
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
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
    const password = input.newPassword
      ? await hashAdminPassword(input.newPassword)
      : installation.owner.password;
    let twoFactor = installation.owner.twoFactor;
    if (twoFactor) {
      if (!input.otpCode) {
        throw new ApiError(
          "Enter an authenticator or backup code.",
          "ADMIN_SECOND_FACTOR_REQUIRED",
          401,
        );
      }
      const secondFactor = verifyAdminSecondFactor(
        input.otpCode,
        twoFactor,
        installation.sessionSecret,
      );
      if (!secondFactor.valid) {
        throw new ApiError(
          "Authenticator or backup code is incorrect.",
          "ADMIN_SECOND_FACTOR_REJECTED",
          401,
        );
      }
      if (secondFactor.recoveryCodeIndex !== null) {
        twoFactor = withoutRecoveryCode(
          twoFactor,
          secondFactor.recoveryCodeIndex,
        );
      }
    }
    audit = securityAuditOperation({
      action: "admin.account.updated",
      actor: installationAdministratorAuditActor(),
      targetType: "user",
    });
    await audit.attempt();
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      { password, twoFactor, username: input.username },
    );
    audit.applied();
    await audit.success();
    const response = apiSuccess({
      security: {
        recoveryCodesRemaining:
          updated.owner.twoFactor?.recoveryCodes.length ?? 0,
        recoveryConfigured: isAdminRecoveryConfigured(),
        twoFactorEnabled: updated.owner.twoFactor !== null,
      },
      username: updated.owner.username,
    });
    response.cookies.set(
      ADMIN_COOKIE,
      await issueAdminToken(updated),
      {
        ...adminCookieOptions,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to update administrator account.");
  }
};
