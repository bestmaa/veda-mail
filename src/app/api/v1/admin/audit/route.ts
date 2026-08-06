import { z } from "zod";

import { assertAdminAccess } from "@/server/auth/admin-session";
import { securityAuditStore } from "@/server/security-audit/security-audit.store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

const querySchema = z.object({
  beforeSequence: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

const parseQuery = (request: Request) => {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (key !== "beforeSequence" && key !== "limit") {
      throw new ApiError("The audit query is invalid.", "INVALID_AUDIT_QUERY", 400);
    }
    if (parameters.getAll(key).length !== 1) {
      throw new ApiError("The audit query is invalid.", "INVALID_AUDIT_QUERY", 400);
    }
  }
  return querySchema.parse({
    ...(parameters.has("beforeSequence")
      ? { beforeSequence: parameters.get("beforeSequence") }
      : {}),
    ...(parameters.has("limit") ? { limit: parameters.get("limit") } : {}),
  });
};

export const GET = async (request: Request) => {
  try {
    await assertAdminAccess();
    assertRequestRateLimit(request, "admin-security-audit-read", 5_000, 120, 60_000);
    assertSubjectRateLimit(
      "admin-security-audit-read",
      "administrator",
      120,
      60_000,
    );
    const query = parseQuery(request);
    return apiSuccess(await securityAuditStore.list({
      ...(query.beforeSequence === undefined
        ? {}
        : { beforeSequence: query.beforeSequence }),
      limit: query.limit,
    }));
  } catch (error) {
    return apiFailure(error, "Unable to load the security audit log.");
  }
};
