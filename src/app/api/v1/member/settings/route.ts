import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { loadAttachmentCapability } from "@/server/mail/attachment-service";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import {
  memberPasswordChangeSchema,
  memberProfileUpdateSchema,
} from "@/transport/http/request-schemas";

export const runtime = "nodejs";

const MAX_MEMBER_SETTINGS_BODY_BYTES = 16 * 1024;

const context = async (connection: ProviderConnection) => {
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
      mail: provider.manifest.capabilities,
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
    const connection = await getCurrentConnection();
    assertSubjectRateLimit(
      "member-settings-read",
      connection.id,
      120,
      60 * 1000,
    );
    const { capabilities, gateway } = await context(connection);
    const attachmentCapability = await loadAttachmentCapability(connection);
    return apiSuccess({
      attachmentCapability: {
        status: attachmentCapability.status,
      },
      capabilities: {
        ...capabilities,
        mail: {
          ...capabilities.mail,
          maxAttachmentBytes: attachmentCapability.maxAttachmentBytes ?? 0,
        },
      },
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
    const connection = await getCurrentConnection();
    assertSubjectRateLimit("member-profile", connection.id, 20, 15 * 60 * 1000);
    const input = memberProfileUpdateSchema.parse(
      await readJsonBody(request, MAX_MEMBER_SETTINGS_BODY_BYTES),
    );
    const current = await context(connection);
    try {
      return apiSuccess({
        profile: await current.gateway.updateMemberProfile(input),
      });
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
    const verifiedConnection = await getCurrentConnection();
    assertSubjectRateLimit(
      "member-password",
      verifiedConnection.id,
      5,
      15 * 60 * 1000,
    );
    const input = memberPasswordChangeSchema.parse(
      await readJsonBody(request, MAX_MEMBER_SETTINGS_BODY_BYTES),
    );
    const current = await context(verifiedConnection);
    const { connection, gateway, profile, provider } = current;
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
    const authentication = await provider.authenticateMember(profile.config, {
      email: account.email,
      password: input.newPassword,
      ...(input.otpCode ? { otpCode: input.otpCode } : {}),
    });
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
