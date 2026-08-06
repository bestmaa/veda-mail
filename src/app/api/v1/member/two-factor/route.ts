import { getProviderRegistry } from "@/bootstrap/provider-registry";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import { assertSubjectRateLimit } from "@/server/security/rate-limit";
import { memberAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { assertOrganizationFeatureEnabled } from "@/server/organization/organization-policy.service";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import {
  memberTwoFactorConfirmSchema,
  memberTwoFactorDisableSchema,
} from "@/transport/http/request-schemas";

export const runtime = "nodejs";

const MAX_TWO_FACTOR_BODY_BYTES = 16 * 1024;

const context = async (connection: ProviderConnection) => {
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
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit(
      "member-two-factor-start",
      connection.id,
      3,
      60 * 60 * 1_000,
    );
    await assertOrganizationFeatureEnabled("memberTwoFactorEnrollment");
    const current = await context(connection);
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
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const auditActor = memberAuditActor(connection);
    assertSubjectRateLimit(
      "member-two-factor-confirm",
      connection.id,
      5,
      15 * 60 * 1_000,
    );
    await assertOrganizationFeatureEnabled("memberTwoFactorEnrollment");
    const input = memberTwoFactorConfirmSchema.parse(
      await readJsonBody(request, MAX_TWO_FACTOR_BODY_BYTES),
    );
    const current = await context(connection);
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
    audit = securityAuditOperation({
      action: "member.two-factor.enrolled",
      actor: auditActor,
      targetType: "two-factor",
    });
    await audit.attempt();
    const recoveryCodes = await memberTwoFactorSecurity.enable(
      current.account.email,
      enrollment.otpUrl,
    );
    audit.applied();
    await audit.success();
    twoFactorEnrollmentStore.remove(current.connection.id);
    connectionStore.updateConfig(current.connection.id, config);
    return apiSuccess({
      enabled: true,
      recoveryCodes,
      sessionActive: true,
    });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to enable two-factor authentication.");
  }
};

export const DELETE = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const auditActor = memberAuditActor(connection);
    assertSubjectRateLimit(
      "member-two-factor-disable",
      connection.id,
      5,
      15 * 60 * 1_000,
    );
    const input = memberTwoFactorDisableSchema.parse(
      await readJsonBody(request, MAX_TWO_FACTOR_BODY_BYTES),
    );
    const current = await context(connection);
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
    audit = securityAuditOperation({
      action: "member.two-factor.disabled",
      actor: auditActor,
      targetType: "two-factor",
    });
    await audit.attempt();
    await memberTwoFactorSecurity.disable(current.account.email);
    audit.applied();
    await audit.success();
    twoFactorEnrollmentStore.remove(current.connection.id);
    connectionStore.updateConfig(current.connection.id, config);
    return apiSuccess({ enabled: false, sessionActive: true });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to disable two-factor authentication.");
  }
};
