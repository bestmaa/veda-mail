import "server-only";

import { z } from "zod";

export const MAX_RULE_AUDIT_ENTRIES = 500;

export const ruleAuditOperationSchema = z.enum([
  "create",
  "delete",
  "deployment-conflict",
  "deployment-deployed",
  "deployment-failed",
  "deployment-intent",
  "reorder",
  "toggle",
  "update",
]);

export const ruleAuditEntrySchema = z.object({
  at: z.string().datetime(),
  id: z.string().uuid(),
  operation: ruleAuditOperationSchema,
  ruleId: z.string().uuid().nullable(),
}).strict();

export type RuleAuditEntry = z.infer<typeof ruleAuditEntrySchema>;
export type RuleAuditOperation = z.infer<typeof ruleAuditOperationSchema>;

export const appendRuleAudit = (
  current: readonly RuleAuditEntry[],
  operation: RuleAuditOperation,
  ruleId: string | null,
  at: string,
): readonly RuleAuditEntry[] => [
  ...current,
  ruleAuditEntrySchema.parse({
    at,
    id: crypto.randomUUID(),
    operation,
    ruleId,
  }),
].slice(-MAX_RULE_AUDIT_ENTRIES);
