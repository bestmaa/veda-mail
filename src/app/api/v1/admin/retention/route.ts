import { assertAdminAccess } from "@/server/auth/admin-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { dataRetentionPolicySchema } from "@/server/organization/data-retention-policy.schema";
import { dataRetentionPolicyStore } from "@/server/organization/data-retention-policy.store";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { installationAdministratorAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { securityAuditStore } from "@/server/security-audit/security-audit.store";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess({ policy: await dataRetentionPolicyStore.get() });
  } catch (error) {
    return apiFailure(error, "Unable to load data-retention policy.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(request, "admin-retention", 1_000, 60, 10 * 60_000);
    assertSubjectRateLimit("admin-retention", "administrator", 10, 10 * 60_000);
    const policy = dataRetentionPolicySchema.parse(await readJsonBody(request, 4_096));
    audit = securityAuditOperation({
      action: "admin.retention.updated",
      actor: installationAdministratorAuditActor(),
      targetType: "retention",
    });
    await audit.attempt();
    const saved = await dataRetentionPolicyStore.put(policy);
    audit.applied();
    await securityAuditStore.applyRetention();
    await audit.success();
    return apiSuccess({ policy: saved });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to save data-retention policy.");
  }
};
