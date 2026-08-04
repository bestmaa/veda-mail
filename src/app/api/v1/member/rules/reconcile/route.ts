import { z } from "zod";

import { MAX_MAIL_RULE_REQUEST_BYTES } from "@/domain/mail/rule";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { reconcileRules } from "@/server/rules/rule-deployment.service";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const inputSchema = z.object({
  expectedRevision: z.string().uuid(),
}).strict();

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "member-rule-reconcile", 5_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("member-rule-reconcile", connection.id, 20, 15 * 60_000);
    const input = inputSchema.parse(
      await readJsonBody(request, MAX_MAIL_RULE_REQUEST_BYTES),
    );
    return apiSuccess(await reconcileRules(connection, input.expectedRevision));
  } catch (error) {
    return apiFailure(error, "Unable to reconcile mail rules.");
  }
};
