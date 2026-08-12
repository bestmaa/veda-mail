import { assertAdminAccess } from "@/server/auth/admin-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { organizationFeaturePolicySchema } from "@/server/organization/organization-policy.schema";
import { organizationPolicyStore } from "@/server/organization/organization-policy.store";
import { getAdminCapabilitySnapshot } from "@/server/organization/organization-policy.service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { installationAdministratorAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_POLICY_BODY_BYTES = 4 * 1024;

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess(await getAdminCapabilitySnapshot());
  } catch (error) {
    return apiFailure(error, "Unable to load organization capabilities.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    await assertRequestRateLimit(
      request,
      "admin-capabilities",
      1_000,
      100,
      10 * 60 * 1_000,
    );
    await assertSubjectRateLimit(
      "admin-capabilities",
      "administrator",
      20,
      10 * 60 * 1_000,
    );
    const policy = organizationFeaturePolicySchema.parse(
      await readJsonBody(request, MAX_POLICY_BODY_BYTES),
    );
    audit = securityAuditOperation({
      action: "admin.capabilities.updated",
      actor: installationAdministratorAuditActor(),
      targetType: "organization",
    });
    await audit.attempt();
    await organizationPolicyStore.put(policy);
    audit.applied();
    await audit.success();
    return apiSuccess(await getAdminCapabilitySnapshot());
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to save organization capabilities.");
  }
};
