import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import {
  CONNECTION_COOKIE,
  getCurrentConnection,
} from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSessionRateLimit } from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import {
  memberTwoFactorConfirmSchema,
  memberTwoFactorDisableSchema,
} from "@/transport/http/request-schemas";

export const runtime = "nodejs";

const context = async () => {
  const connection = await getCurrentConnection();
  const gateway = await resolveGateway(connection);
  const profile = await mailServiceProfileStore.get();
  if (!profile) {
    throw new ApiError(
      "The mail service is not configured.",
      "MAIL_SERVICE_NOT_CONFIGURED",
      503,
    );
  }
  return {
    account: await gateway.getAccount(),
    connection,
    profile,
    provider: getProviderRegistry().get(connection.providerId),
  };
};

const authenticatePassword = async (
  input: { readonly currentPassword: string; readonly otpCode?: string },
  current: Awaited<ReturnType<typeof context>>,
) => {
  const authentication = await current.provider.authenticateMember(
    current.profile.config,
    {
      email: current.account.email,
      password: input.currentPassword,
      ...(input.otpCode ? { otpCode: input.otpCode } : {}),
    },
  );
  if (authentication.status !== "authenticated") {
    throw new ApiError(
      "Current mailbox password is incorrect.",
      "TWO_FACTOR_PASSWORD_REJECTED",
      400,
    );
  }
  return authentication.config;
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "member-two-factor-start",
      CONNECTION_COOKIE,
      3,
      60 * 60 * 1_000,
    );
    const current = await context();
    if (await memberTwoFactorSecurity.isEnabled(current.account.email)) {
      throw new ApiError(
        "Two-factor authentication is already enabled.",
        "TWO_FACTOR_ALREADY_ENABLED",
        409,
      );
    }
    const enrollment = await twoFactorEnrollmentStore.create(
      current.connection.id,
      current.account.email,
      current.profile.displayName,
    );
    return apiSuccess({ enrollment }, { status: 201 });
  } catch (error) {
    return apiFailure(error, "Unable to start two-factor setup.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "member-two-factor-confirm",
      CONNECTION_COOKIE,
      5,
      15 * 60 * 1_000,
    );
    const input = memberTwoFactorConfirmSchema.parse(await request.json());
    const current = await context();
    const enrollment = twoFactorEnrollmentStore.verify(
      current.connection.id,
      input.otpCode,
    );
    if (!enrollment) {
      throw new ApiError(
        "That verification code is incorrect or setup expired.",
        "TWO_FACTOR_CODE_REJECTED",
        400,
      );
    }
    const config = await authenticatePassword(input, current);
    const recoveryCodes = await memberTwoFactorSecurity.enable(
      current.account.email,
      enrollment.otpUrl,
    );
    twoFactorEnrollmentStore.remove(current.connection.id);
    connectionStore.updateConfig(current.connection.id, config);
    return apiSuccess({
      enabled: true,
      recoveryCodes,
      sessionActive: true,
    });
  } catch (error) {
    return apiFailure(error, "Unable to enable two-factor authentication.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "member-two-factor-disable",
      CONNECTION_COOKIE,
      5,
      15 * 60 * 1_000,
    );
    const input = memberTwoFactorDisableSchema.parse(await request.json());
    const current = await context();
    const config = await authenticatePassword(input, current);
    if (
      !(await memberTwoFactorSecurity.verify(
        current.account.email,
        input.otpCode,
      ))
    ) {
      throw new ApiError(
        "Current password or verification code is incorrect.",
        "TWO_FACTOR_DISABLE_REJECTED",
        400,
      );
    }
    await memberTwoFactorSecurity.disable(current.account.email);
    twoFactorEnrollmentStore.remove(current.connection.id);
    connectionStore.updateConfig(current.connection.id, config);
    return apiSuccess({ enabled: false, sessionActive: true });
  } catch (error) {
    return apiFailure(error, "Unable to disable two-factor authentication.");
  }
};
