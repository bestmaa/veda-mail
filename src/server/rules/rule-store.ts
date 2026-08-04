import "server-only";

import {
  MAX_MAIL_RULES,
  type MailRule,
  type MailRulePutOperation,
  type RuleDeploymentResult,
} from "@/domain/mail/rule";
import type { ProviderConnection } from "@/domain/provider/provider";
import { appendRuleAudit, type RuleAuditOperation } from "@/server/rules/rule-audit";
import { decryptRuleBook, encryptRuleBook, ruleOwnerKey } from "@/server/rules/rule-crypto";
import { readRuleFile, writeRuleFile } from "@/server/rules/rule-file";
import { assertRuleKeyCheck, ruleKeyCheck } from "@/server/rules/rule-key";
import {
  type MailRuleOwner,
  emptyRuleBookProjection,
  MAX_RULE_OWNERS,
  parseStoredRuleBook,
  projectRuleBook,
  type RuleBookProjection,
  ruleConnectionSchema,
  type RuleDeploymentWork,
  type StoredRuleBook,
} from "@/server/rules/rule-record";
import { parseMailRule } from "@/server/rules/rule-schema";
import { ApiError } from "@/transport/http/api-error";

export type RuleDeploymentFinalize =
  | RuleDeploymentResult
  | { readonly errorCode: string; readonly status: "conflict" | "failed" };

export type RuleStoreOperation = MailRulePutOperation | {
  readonly connection: ProviderConnection;
  readonly expectedRevision: string;
  readonly operation: "persist-deployment-intent";
} | {
  readonly expectedRevision: string;
  readonly intentId: string;
  readonly operation: "finalize-deployment";
  readonly result: RuleDeploymentFinalize;
};

const globalState = globalThis as typeof globalThis & {
  __vedaMailRuleQueue?: Promise<void>;
};
globalState.__vedaMailRuleQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailRuleQueue!.then(task, task);
  globalState.__vedaMailRuleQueue = result.then(() => undefined, () => undefined);
  return result;
};

const fail = (message: string, code: string, status: number): never => {
  throw new ApiError(message, code, status);
};
const unavailable = (): never => fail(
  "Mail rules are temporarily unavailable.", "MAIL_RULE_STORE_UNAVAILABLE", 500,
);

const load = async (owner: MailRuleOwner) => {
  try {
    const file = await readRuleFile();
    if (file.keyCheck) assertRuleKeyCheck(file.keyCheck);
    const ownerKey = ruleOwnerKey(owner);
    return {
      book: file.owners[ownerKey]
        ? decryptRuleBook(file.owners[ownerKey]!, ownerKey)
        : null,
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};

const assertRevision = (
  book: StoredRuleBook | null,
  expected: string | null,
): void => {
  if ((book?.revision ?? null) !== expected) fail(
    "Mail rules changed in another session. Reload and try again.",
    "MAIL_RULE_BOOK_CONFLICT", 409,
  );
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
        operation.ruleIds.some((ruleId) => !expected.includes(ruleId))) {
      fail("Rule order must contain every rule exactly once.", "MAIL_RULE_ORDER_INVALID", 422);
    }
    const byId = new Map(current.map((rule) => [rule.id, rule]));
    return { audit: "reorder", ruleId: null, rules: operation.ruleIds.map((id) => byId.get(id)!) };
  }
  const index = current.findIndex(({ id }) => id === operation.ruleId);
  if (index < 0) fail("The mail rule was not found.", "MAIL_RULE_NOT_FOUND", 404);
  if (operation.operation === "delete") {
    return { audit: "delete", ruleId: operation.ruleId, rules: current.filter((_, i) => i !== index) };
  }
  const existing = current[index]!;
  const updated = parseMailRule(operation.operation === "toggle"
    ? { ...existing, enabled: operation.enabled, updatedAt: now }
    : { ...existing, ...operation.definition, id: existing.id, createdAt: existing.createdAt, updatedAt: now });
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
    connection: current?.connection ?? null,
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
  operation: Exclude<RuleStoreOperation, MailRulePutOperation>,
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
    "The mail-rule deployment intent is stale.", "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
  );
  const deployed = operation.result.status === "deployed";
  const audit = deployed ? "deployment-deployed" :
    operation.result.status === "conflict" ? "deployment-conflict" : "deployment-failed";
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

const persist = async (
  current: Awaited<ReturnType<typeof load>>,
  book: StoredRuleBook,
): Promise<RuleBookProjection> => {
  if (!current.file.owners[current.ownerKey] &&
      Object.keys(current.file.owners).length >= MAX_RULE_OWNERS) fail(
    "The installation cannot store another rule owner.", "MAIL_RULE_OWNER_LIMIT_REACHED", 507,
  );
  try {
    await writeRuleFile({ keyCheck: ruleKeyCheck(),
      owners: { ...current.file.owners, [current.ownerKey]: encryptRuleBook(book, current.ownerKey) },
      updatedAt: book.updatedAt, version: 1 });
    return projectRuleBook(book);
  } catch {
    return unavailable();
  }
};

export const ruleStore = {
  async get(owner: MailRuleOwner): Promise<RuleBookProjection> {
    const current = await load(owner);
    return current.book ? projectRuleBook(current.book) : emptyRuleBookProjection();
  },
  async persistDeploymentIntent(
    owner: MailRuleOwner,
    expectedRevision: string,
    connection: ProviderConnection,
  ): Promise<RuleDeploymentWork> {
    const projection = await ruleStore.put(owner, {
      connection, expectedRevision, operation: "persist-deployment-intent",
    });
    return ruleStore.getDeploymentWork(owner, projection.deployment.intentId!);
  },
  async getDeploymentWork(owner: MailRuleOwner, intentId: string): Promise<RuleDeploymentWork> {
    const { book } = await load(owner);
    const ready = book ?? unavailable();
    const connection = ready.connection ?? fail(
      "The mail-rule deployment intent is unavailable.", "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
    );
    if (ready.deployment.status !== "pending" ||
        ready.deployment.intentId !== intentId) fail(
      "The mail-rule deployment intent is unavailable.", "MAIL_RULE_DEPLOYMENT_CONFLICT", 409,
    );
    return { connection, desiredRevision: ready.deployment.desiredRevision!,
      intentId, rules: ready.rules };
  },
  async put(owner: MailRuleOwner, operation: RuleStoreOperation): Promise<RuleBookProjection> {
    return serialized(async () => {
      const current = await load(owner);
      assertRevision(current.book, operation.expectedRevision);
      if (!current.book && operation.operation !== "create") fail(
        "The mail-rule book was not found.", "MAIL_RULE_NOT_FOUND", 404,
      );
      const now = new Date().toISOString();
      const updated = operation.operation === "persist-deployment-intent" ||
        operation.operation === "finalize-deployment"
        ? deploymentMutation(current.book!, operation, now)
        : desiredMutation(current.book, operation, now);
      return persist(current, updated);
    });
  },
};
