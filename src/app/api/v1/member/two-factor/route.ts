import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { CONNECTION_COOKIE, getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSessionRateLimit } from "@/server/security/rate-limit";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
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
  const provider = getProviderRegistry().get(connection.providerId);
  const profile = await mailServiceProfileStore.get();
  if (!profile) {
    throw new ApiError(
      "The mail service is not configured.",
      "MAIL_SERVICE_NOT_CONFIGURED",
      503,
    );
  }
  if (!provider.manifest.capabilities.supportsTwoFactorAuthentication) {
    throw new ApiError(
      "Two-factor authentication is not supported by this mail service.",
      "TWO_FACTOR_NOT_SUPPORTED",
      400,
    );
  }
  return { connection, gateway, profile, provider };
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
    const { connection, gateway, profile } = await context();
    if (await gateway.getTwoFactorEnabled()) {
      throw new ApiError(
        "Two-factor authentication is already enabled.",
        "TWO_FACTOR_ALREADY_ENABLED",
        409,
      );
    }
    const account = await gateway.getAccount();
    const enrollment = await twoFactorEnrollmentStore.create(
      connection.id,
      account.email,
      profile.displayName,
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
    const { connection, gateway, profile, provider } = await context();
    const account = await gateway.getAccount();
    const enrollment = twoFactorEnrollmentStore.verify(
      connection.id,
      input.otpCode,
    );
    if (!enrollment) {
      throw new ApiError(
        "That verification code is incorrect or the setup expired.",
        "TWO_FACTOR_CODE_REJECTED",
        400,
      );
    }
    try {
      await gateway.updateTwoFactor({
        currentPassword: input.currentPassword,
        otpCode: input.otpCode,
        otpUrl: enrollment.otpUrl,
      });
    } catch {
      throw new ApiError(
        "Current password is incorrect.",
        "TWO_FACTOR_ENABLE_REJECTED",
        400,
      );
    }
    twoFactorEnrollmentStore.remove(connection.id);
    const authentication = await provider.authenticateMember(profile.config, {
      email: account.email,
      otpCode: input.otpCode,
      password: input.currentPassword,
    });
    if (authentication.status === "authenticated") {
      connectionStore.updateConfig(connection.id, authentication.config);
      return apiSuccess({ enabled: true, sessionActive: true });
    }
    connectionStore.remove(connection.id);
    return apiSuccess({ enabled: true, sessionActive: false });
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
    const { connection, gateway, profile, provider } = await context();
    const account = await gateway.getAccount();
    try {
      await gateway.updateTwoFactor({
        currentPassword: input.currentPassword,
        otpCode: input.otpCode,
        otpUrl: null,
      });
    } catch {
      throw new ApiError(
        "Current password or verification code is incorrect.",
        "TWO_FACTOR_DISABLE_REJECTED",
        400,
      );
    }
    twoFactorEnrollmentStore.remove(connection.id);
    const authentication = await provider.authenticateMember(profile.config, {
      email: account.email,
      password: input.currentPassword,
    });
    if (authentication.status === "authenticated") {
      connectionStore.updateConfig(connection.id, authentication.config);
      return apiSuccess({ enabled: false, sessionActive: true });
    }
    connectionStore.remove(connection.id);
    return apiSuccess({ enabled: false, sessionActive: false });
  } catch (error) {
    return apiFailure(error, "Unable to disable two-factor authentication.");
  }
};
