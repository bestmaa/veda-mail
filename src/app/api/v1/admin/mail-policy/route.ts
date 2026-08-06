import { assertAdminAccess } from "@/server/auth/admin-session";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { mailContentPolicySchema } from "@/server/organization/mail-content-policy.schema";
import { mailContentPolicyStore } from "@/server/organization/mail-content-policy.store";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";
const MAX_POLICY_BODY_BYTES = 16 * 1024;

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess({ policy: await mailContentPolicyStore.get() });
  } catch (error) {
    return apiFailure(error, "Unable to load mail content policy.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(request, "admin-mail-policy", 1_000, 100, 10 * 60 * 1_000);
    assertSubjectRateLimit("admin-mail-policy", "administrator", 20, 10 * 60 * 1_000);
    const policy = mailContentPolicySchema.parse(
      await readJsonBody(request, MAX_POLICY_BODY_BYTES),
    );
    return apiSuccess({ policy: await mailContentPolicyStore.put(policy) });
  } catch (error) {
    return apiFailure(error, "Unable to save mail content policy.");
  }
};
