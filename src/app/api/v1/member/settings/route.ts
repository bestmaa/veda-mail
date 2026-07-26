import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { CONNECTION_COOKIE, getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { assertSessionRateLimit } from "@/server/security/rate-limit";
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
  return {
    capabilities: {
      passwordChange: provider.manifest.capabilities.supportsPasswordChange,
      profileSettings: provider.manifest.capabilities.supportsProfileSettings,
    },
    connection,
    gateway,
    provider,
  };
};

export const GET = async () => {
  try {
    const { capabilities, gateway } = await context();
    return apiSuccess({
      capabilities,
      profile: await gateway.getMemberProfile(),
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
    const { connection, gateway, provider } = await context();
    try {
      await gateway.changePassword(input);
    } catch {
      throw new ApiError(
        "Current password or verification code is incorrect.",
        "PASSWORD_CHANGE_REJECTED",
        400,
      );
    }
    const config = provider.rotateMemberSecret(
      connection.config,
      input.newPassword,
    );
    connectionStore.updateConfig(connection.id, config);
    return apiSuccess({ changed: true });
  } catch (error) {
    return apiFailure(error, "Unable to change the mailbox password.");
  }
};
