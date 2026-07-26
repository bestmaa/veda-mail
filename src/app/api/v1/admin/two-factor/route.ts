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
import { assertSessionRateLimit } from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

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
    assertSessionRateLimit(
      request,
      "admin-two-factor-start",
      ADMIN_COOKIE,
      3,
      60 * 60 * 1_000,
    );
    const installation = await currentInstallation();
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
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "admin-two-factor-confirm",
      ADMIN_COOKIE,
      8,
      15 * 60 * 1_000,
    );
    const input = adminTwoFactorConfirmSchema.parse(await request.json());
    const installation = await currentInstallation();
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
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      {
        password: installation.owner.password,
        twoFactor: confirmed.twoFactor,
        username: installation.owner.username,
      },
    );
    return setSession(
      apiSuccess({
        enabled: true,
        recoveryCodes: confirmed.recoveryCodes,
      }),
      updated,
    );
  } catch (error) {
    return apiFailure(error, "Unable to enable administrator 2FA.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "admin-two-factor-disable",
      ADMIN_COOKIE,
      5,
      15 * 60 * 1_000,
    );
    const input = adminTwoFactorDisableSchema.parse(await request.json());
    const installation = await currentInstallation();
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
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      {
        password: installation.owner.password,
        twoFactor: null,
        username: installation.owner.username,
      },
    );
    adminTwoFactorEnrollmentStore.remove(
      installation.owner.authVersion,
      installation.owner.username,
    );
    return setSession(apiSuccess({ enabled: false }), updated);
  } catch (error) {
    return apiFailure(error, "Unable to disable administrator 2FA.");
  }
};
