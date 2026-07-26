import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { CONNECTION_COOKIE, getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSessionRateLimit } from "@/server/security/rate-limit";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import {
  memberPasswordChangeSchema,
  memberProfileUpdateSchema,
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
  return {
    capabilities: {
      passwordChange: provider.manifest.capabilities.supportsPasswordChange,
      profileSettings: provider.manifest.capabilities.supportsProfileSettings,
      twoFactorAuthentication: true,
    },
    connection,
    gateway,
    profile,
    provider,
  };
};

export const GET = async () => {
  try {
    const { capabilities, gateway } = await context();
    return apiSuccess({
      capabilities,
      profile: await gateway.getMemberProfile(),
      security: {
        twoFactorEnabled: await memberTwoFactorSecurity.isEnabled(
          (await gateway.getAccount()).email,
        ),
      },
    });
  } catch (error) {
    return apiFailure(error, "Unable to load profile settings.");
  }
};

export const PATCH = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "member-profile",
      CONNECTION_COOKIE,
      20,
      15 * 60 * 1000,
    );
    const input = memberProfileUpdateSchema.parse(await request.json());
    const { gateway } = await context();
    try {
      return apiSuccess({ profile: await gateway.updateMemberProfile(input) });
    } catch {
      throw new ApiError(
        "The profile name could not be updated.",
        "PROFILE_UPDATE_REJECTED",
        400,
      );
    }
  } catch (error) {
    return apiFailure(error, "Unable to update profile settings.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertSessionRateLimit(
      request,
      "member-password",
      CONNECTION_COOKIE,
      5,
      15 * 60 * 1000,
    );
    const input = memberPasswordChangeSchema.parse(await request.json());
    const { connection, gateway, profile, provider } = await context();
    const account = await gateway.getAccount();
    try {
      await gateway.changePassword(input);
    } catch {
      throw new ApiError(
        "Current password or verification code is incorrect.",
        "PASSWORD_CHANGE_REJECTED",
        400,
      );
    }
    const authentication = await provider.authenticateMember(
      profile.config,
      {
        email: account.email,
        password: input.newPassword,
        ...(input.otpCode ? { otpCode: input.otpCode } : {}),
      },
    );
    if (authentication.status === "authenticated") {
      connectionStore.updateConfig(connection.id, authentication.config);
      return apiSuccess({ changed: true, sessionActive: true });
    }
    connectionStore.remove(connection.id);
    return apiSuccess({ changed: true, sessionActive: false });
  } catch (error) {
    return apiFailure(error, "Unable to change the mailbox password.");
  }
};
