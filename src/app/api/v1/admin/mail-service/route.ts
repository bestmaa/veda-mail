import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type { ProviderId } from "@/domain/shared/brand";
import { assertAdminAccess } from "@/server/auth/admin-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  mailServiceProfileInputSchema,
} from "@/server/mail-service/mail-service-profile.schema";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  auditTargetId,
  installationAdministratorAuditActor,
} from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_MAIL_SERVICE_PROFILE_BODY_BYTES = 64 * 1024;

const findProvider = (providerId: ProviderId): ProviderModule => {
  try {
    return getProviderRegistry().get(providerId);
  } catch {
    throw new ApiError("Unknown mail provider.", "UNKNOWN_PROVIDER", 400);
  }
};

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess({
      configuration: await mailServiceProfileStore.get(),
      providers: getProviderRegistry().list(),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load mail-service settings.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-mail-service",
      1_000,
      100,
      10 * 60 * 1000,
    );
    assertSubjectRateLimit(
      "admin-mail-service",
      "administrator",
      20,
      10 * 60 * 1000,
    );
    const input = mailServiceProfileInputSchema.parse(
      await readJsonBody(request, MAX_MAIL_SERVICE_PROFILE_BODY_BYTES),
    );
    const provider = findProvider(input.providerId);
    const config = await provider.validateServiceConfig(input.config);
    audit = securityAuditOperation({
      action: "admin.mail-service.updated",
      actor: installationAdministratorAuditActor(),
      targetId: auditTargetId("mail-service", input.providerId),
      targetType: "mail-service",
    });
    await audit.attempt();
    const configuration = await mailServiceProfileStore.put({
      ...input,
      config,
    });
    connectionStore.clearAll();
    audit.applied();
    await audit.success();
    return apiSuccess({
      configuration,
      providers: getProviderRegistry().list(),
    });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to save mail-service settings.");
  }
};
