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
import {
  auditTargetId,
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const inputSchema = z.object({
  expectedRevision: z.string().uuid(),
}).strict();

export const POST = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "member-rule-reconcile", 5_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const auditActor = memberAuditActor(connection);
    await assertSubjectRateLimit("member-rule-reconcile", connection.id, 20, 15 * 60_000);
    const input = inputSchema.parse(
      await readJsonBody(request, MAX_MAIL_RULE_REQUEST_BYTES),
    );
    audit = securityAuditOperation({
      action: "member.rule.reconciled",
      actor: auditActor,
      targetId: auditTargetId("rule-revision", input.expectedRevision),
      targetType: "rule",
    });
    await audit.attempt();
    const book = await reconcileRules(connection, input.expectedRevision);
    audit.applied();
    await audit.success();
    return apiSuccess(book);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to reconcile mail rules.");
  }
};
