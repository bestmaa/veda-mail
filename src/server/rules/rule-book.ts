import "server-only";

import {
  MAX_MAIL_RULES,
  type MailRule,
  type MailRulePutOperation,
} from "@/domain/mail/rule";
import { appendRuleAudit, type RuleAuditOperation } from
  "@/server/rules/rule-audit";
import { createImportedRuleBook } from "@/server/rules/rule-import";
import {
  emptyRuleBookProjection,
  parseStoredRuleBook,
  ruleConnectionSchema,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import { parseMailRule } from "@/server/rules/rule-schema";
import type {
  RuleDeploymentOperation,
  RuleStoreOperation,
} from "@/server/rules/rule-store-operation";
import { ApiError } from "@/transport/http/api-error";

const fail = (message: string, code: string, status: number): never => {
  throw new ApiError(message, code, status);
};

const mutateRules = (
  current: readonly MailRule[],
  operation: MailRulePutOperation,
  now: string,
): { audit: RuleAuditOperation; ruleId: string | null; rules: readonly MailRule[] } => {
  if (operation.operation === "create") {
    if (current.length >= MAX_MAIL_RULES) fail(
      `Each identity can contain at most ${MAX_MAIL_RULES} mail rules.`,
      "MAIL_RULE_LIMIT_REACHED", 422,
    );
    const rule = parseMailRule({
      ...operation.definition, createdAt: now, id: crypto.randomUUID(), updatedAt: now,
    });
    return { audit: "create", ruleId: rule.id, rules: [...current, rule] };
  }
  if (operation.operation === "reorder") {
    const expected = current.map(({ id }) => id);
    if (operation.ruleIds.length !== expected.length ||
        new Set(operation.ruleIds).size !== expected.length ||
        operation.ruleIds.some((ruleId) => !expected.includes(ruleId))) fail(
      "Rule order must contain every rule exactly once.",
      "MAIL_RULE_ORDER_INVALID", 422,
    );
    const byId = new Map(current.map((rule) => [rule.id, rule]));
    return {
      audit: "reorder", ruleId: null,
      rules: operation.ruleIds.map((id) => byId.get(id)!),
    };
  }
  const index = current.findIndex(({ id }) => id === operation.ruleId);
  if (index < 0) fail(
    "The mail rule was not found.", "MAIL_RULE_NOT_FOUND", 404,
  );
  if (operation.operation === "delete") return {
    audit: "delete",
    ruleId: operation.ruleId,
    rules: current.filter((_, itemIndex) => itemIndex !== index),
  };
  const existing = current[index]!;
  const updated = parseMailRule(operation.operation === "toggle"
    ? { ...existing, enabled: operation.enabled, updatedAt: now }
    : { ...existing, ...operation.definition, id: existing.id,
      createdAt: existing.createdAt, updatedAt: now });
  const rules = [...current];
  rules[index] = updated;
  return { audit: operation.operation, ruleId: updated.id, rules };
};

const desiredMutation = (
  current: StoredRuleBook | null,
  operation: MailRulePutOperation,
  now: string,
): StoredRuleBook => {
  const change = mutateRules(current?.rules ?? [], operation, now);
  const revision = crypto.randomUUID();
  return parseStoredRuleBook({
    audit: appendRuleAudit(current?.audit ?? [], change.audit, change.ruleId, now),
    connection: null,
    createdAt: current?.createdAt ?? now,
    deployment: {
      ...(current?.deployment ?? emptyRuleBookProjection().deployment),
      desiredRevision: revision, errorCode: null, intentId: null,
      status: "undeployed", updatedAt: now,
    },
    revision, rules: change.rules, updatedAt: now, version: 1,
  });
};

const deploymentMutation = (
  current: StoredRuleBook,
  operation: RuleDeploymentOperation,
  now: string,
): StoredRuleBook => {
  if (operation.operation === "persist-deployment-intent") {
    const intentId = crypto.randomUUID();
    return parseStoredRuleBook({
      ...current,
      audit: appendRuleAudit(current.audit, "deployment-intent", null, now),
      connection: ruleConnectionSchema.parse(operation.connection),
      deployment: { ...current.deployment, desiredRevision: current.revision,
        errorCode: null, intentId, status: "pending", updatedAt: now },
      revision: crypto.randomUUID(), updatedAt: now,
    });
  }
  if (current.deployment.status !== "pending" ||
      current.deployment.intentId !== operation.intentId) fail(
    "The mail-rule deployment intent is stale.",
    "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
  );
  const deployed = operation.result.status === "deployed";
  const audit = deployed ? "deployment-deployed" :
    operation.result.status === "conflict" ? "deployment-conflict" :
      "deployment-failed";
  return parseStoredRuleBook({
    ...current,
    audit: appendRuleAudit(current.audit, audit, null, now),
    connection: null,
    deployment: {
      ...current.deployment,
      errorCode: deployed ? null : operation.result.errorCode,
      intentId: null,
      ...(deployed ? operation.result : {}),
      status: operation.result.status,
      updatedAt: now,
    },
    revision: crypto.randomUUID(), updatedAt: now,
  });
};

export const updateRuleBook = (
  current: StoredRuleBook | null,
  operation: RuleStoreOperation,
  now: string,
): StoredRuleBook => {
  if (!current && operation.operation !== "create" &&
      operation.operation !== "replace-from-import") fail(
    "The mail-rule book was not found.", "MAIL_RULE_NOT_FOUND", 404,
  );
  if (operation.operation === "replace-from-import") {
    return createImportedRuleBook(current, operation.definitions, now);
  }
  if (operation.operation === "persist-deployment-intent" ||
      operation.operation === "finalize-deployment") {
    return deploymentMutation(current!, operation, now);
  }
  return desiredMutation(current, operation, now);
};
