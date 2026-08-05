import { assertAdminAccess } from "@/server/auth/admin-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { organizationFeaturePolicySchema } from "@/server/organization/organization-policy.schema";
import { organizationPolicyStore } from "@/server/organization/organization-policy.store";
import { getAdminCapabilitySnapshot } from "@/server/organization/organization-policy.service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
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
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-capabilities",
      1_000,
      100,
      10 * 60 * 1_000,
    );
    assertSubjectRateLimit(
      "admin-capabilities",
      "administrator",
      20,
      10 * 60 * 1_000,
    );
    const policy = organizationFeaturePolicySchema.parse(
      await readJsonBody(request, MAX_POLICY_BODY_BYTES),
    );
    await organizationPolicyStore.put(policy);
    return apiSuccess(await getAdminCapabilitySnapshot());
  } catch (error) {
    return apiFailure(error, "Unable to save organization capabilities.");
  }
};
