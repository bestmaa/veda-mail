import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { loadAttachmentCapability } from "@/server/mail/attachment-service";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import {
  assertOrganizationFeatureEnabled,
  getOrganizationPolicy,
} from "@/server/organization/organization-policy.service";
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
  const organizationPolicy = await getOrganizationPolicy();
  return {
    capabilities: {
      mail: provider.manifest.capabilities,
      passwordChange:
        provider.manifest.capabilities.supportsPasswordChange &&
        organizationPolicy.memberPasswordChange,
      profileSettings:
        provider.manifest.capabilities.supportsProfileSettings &&
        organizationPolicy.memberProfileEditing,
      twoFactorAuthentication: organizationPolicy.memberTwoFactorEnrollment,
    },
    connection,
    gateway,
    profile,
    provider,
    organizationPolicy,
  };
};

export const GET = async (request: Request) => {
  try {
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit(
      "member-settings-read",
      connection.id,
      120,
      60 * 1000,
    );
    const { capabilities, gateway, organizationPolicy } = await context(connection);
    const [account, attachmentCapability, mailUpdateMode] = await Promise.all([
      gateway.getAccount(),
      loadAttachmentCapability(connection),
      gateway.getMailUpdateMode(),
    ]);
    const twoFactorEnabled = await memberTwoFactorSecurity.isEnabled(
      account.email,
    );
    return apiSuccess({
      attachmentCapability: {
        status: attachmentCapability.status,
      },
      capabilities: {
        ...capabilities,
        twoFactorAuthentication:
          capabilities.twoFactorAuthentication || twoFactorEnabled,
        mail: {
          ...capabilities.mail,
          maxAttachmentBytes: attachmentCapability.maxAttachmentBytes ?? 0,
          supportsPush: mailUpdateMode === "push",
        },
      },
      organizationPolicy,
      profile: await gateway.getMemberProfile(),
      security: {
        twoFactorEnabled,
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
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("member-profile", connection.id, 20, 15 * 60 * 1000);
    await assertOrganizationFeatureEnabled("memberProfileEditing");
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
    assertMailSessionScope(request, verifiedConnection);
    await assertSubjectRateLimit(
      "member-password",
      verifiedConnection.id,
      5,
      15 * 60 * 1000,
    );
    await assertOrganizationFeatureEnabled("memberPasswordChange");
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
      await connectionStore.updateConfigAsync(connection.id, authentication.config);
      return apiSuccess({ changed: true, sessionActive: true });
    }
    await connectionStore.removeAsync(connection.id);
    return apiSuccess({ changed: true, sessionActive: false });
  } catch (error) {
    return apiFailure(error, "Unable to change the mailbox password.");
  }
};
