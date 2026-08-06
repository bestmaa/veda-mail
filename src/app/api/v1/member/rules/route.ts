import {
  MAX_MAIL_RULE_REQUEST_BYTES,
  type MailRulePutOperation,
} from "@/domain/mail/rule";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  mutateAndDeployRules,
  readRuleWorkspace,
} from "@/server/rules/rule-deployment.service";
import { parseMailRulePutOperation } from "@/server/rules/rule-schema";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const ruleAuditAction = (operation: MailRulePutOperation["operation"]) => {
  if (operation === "create") return "member.rule.created" as const;
  if (operation === "delete") return "member.rule.deleted" as const;
  if (operation === "reorder") return "member.rule.reordered" as const;
  if (operation === "toggle") return "member.rule.toggled" as const;
  return "member.rule.updated" as const;
};

export const GET = async (request: Request) => {
  try {
    assertRequestRateLimit(request, "member-rule-read", 10_000, 300, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    assertSubjectRateLimit("member-rule-read", connection.id, 120, 60_000);
    return apiSuccess(await readRuleWorkspace(connection));
  } catch (error) {
    return apiFailure(error, "Unable to load mail rules.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(request, "member-rule-write", 5_000, 120, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const auditActor = memberAuditActor(connection);
    assertSubjectRateLimit("member-rule-write", connection.id, 30, 15 * 60_000);
    const operation = parseMailRulePutOperation(
      await readJsonBody(request, MAX_MAIL_RULE_REQUEST_BYTES),
    );
    audit = securityAuditOperation({
      action: ruleAuditAction(operation.operation),
      actor: auditActor,
      targetType: "rule",
    });
    await audit.attempt();
    const book = await mutateAndDeployRules(connection, operation);
    audit.applied();
    await audit.success();
    return apiSuccess(book, { status: operation.operation === "create" ? 201 : 200 });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to update mail rules.");
  }
};
