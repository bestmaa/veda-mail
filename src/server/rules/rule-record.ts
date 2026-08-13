import "server-only";

import type { MailRule, MailRuleBook } from "@/domain/mail/rule";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import {
  MAX_RULE_AUDIT_ENTRIES,
  type RuleAuditEntry,
  ruleAuditEntrySchema,
} from "@/server/rules/rule-audit";
import { mailRuleSchema } from "@/server/rules/rule-schema";
import { z } from "zod";

export const MAX_RULE_OWNERS = 10_000;
export const MAX_RULE_BOOK_BYTES = 2 * 1024 * 1024;

const timestampSchema = z.string().datetime();
const nullableBounded = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

export const ruleConnectionSchema = z.object({
  config: z.record(z.string().min(1).max(100), z.string().max(16 * 1024)),
  createdAt: timestampSchema,
  displayName: z.string().min(1).max(80),
  id: z.string().uuid().transform(id.connection),
  providerId: z.string().min(1).max(100).transform(id.provider),
}).strict().refine(
  (connection) => Object.keys(connection.config).length <= 64,
  "The rule connection has too many configuration fields.",
).refine(
  (connection) => Buffer.byteLength(JSON.stringify(connection.config), "utf8") <=
    128 * 1024,
  "The rule connection configuration is too large.",
);

export const ruleDeploymentSchema = z.object({
  desiredRevision: nullableBounded(200),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u).nullable(),
  intentId: z.string().uuid().nullable(),
  providerState: nullableBounded(1_024),
  scriptHash: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/u).nullable(),
  scriptId: nullableBounded(1_024),
  status: z.enum(["conflict", "deployed", "failed", "pending", "undeployed"]),
  updatedAt: timestampSchema,
}).strict().superRefine((deployment, context) => {
  if (deployment.status === "pending" && !deployment.intentId) {
    context.addIssue({ code: "custom", message: "Pending deployment needs intent." });
  }
  if (deployment.status === "deployed" &&
      (!deployment.providerState || !deployment.scriptHash || !deployment.scriptId)) {
    context.addIssue({ code: "custom", message: "Deployed state is incomplete." });
  }
});

export const storedRuleBookSchema = z.object({
  audit: z.array(ruleAuditEntrySchema).max(MAX_RULE_AUDIT_ENTRIES),
  connection: ruleConnectionSchema.nullable(),
  createdAt: timestampSchema,
  deployment: ruleDeploymentSchema,
  revision: z.string().uuid(),
  rules: z.array(mailRuleSchema).max(50),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().superRefine((book, context) => {
  const ids = book.rules.map(({ id: ruleId }) => ruleId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Rule identifiers must be unique." });
  }
  if (Buffer.byteLength(JSON.stringify(book), "utf8") > MAX_RULE_BOOK_BYTES) {
    context.addIssue({ code: "custom", message: "The rule book is too large." });
  }
});

export const encryptedRuleBookSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(4 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();

export const ruleFileSchema = z.object({
  keyCheck: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).nullable(),
  owners: z.record(z.string().regex(/^[A-Za-z0-9_-]{43}$/u), encryptedRuleBookSchema),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().refine(
  (file) => Object.keys(file.owners).length <= MAX_RULE_OWNERS,
  "The rule store contains too many owners.",
);

export interface MailRuleOwner {
  readonly email: string;
  readonly providerId: string;
}

export type RuleDeployment = z.infer<typeof ruleDeploymentSchema>;
export type StoredRuleBook = z.infer<typeof storedRuleBookSchema>;
export type RuleFile = z.infer<typeof ruleFileSchema>;
export type EncryptedRuleBook = RuleFile["owners"][string];

export interface RuleBookProjection extends MailRuleBook {
  readonly audit: readonly RuleAuditEntry[];
  readonly deployment: RuleDeployment;
}

export interface RuleDeploymentWork {
  readonly connection: ProviderConnection;
  readonly desiredRevision: string;
  readonly intentId: string;
  readonly rules: readonly MailRule[];
}

export const emptyRuleBookProjection = (): RuleBookProjection => ({
  audit: [],
  deployment: {
    desiredRevision: null, errorCode: null, intentId: null,
    providerState: null, scriptHash: null, scriptId: null,
    status: "undeployed", updatedAt: new Date(0).toISOString(),
  },
  revision: null,
  rules: [],
  version: 1,
});

export const parseStoredRuleBook = (value: unknown): StoredRuleBook => {
  const parsed = storedRuleBookSchema.parse(value);
  if (JSON.stringify(value) !== JSON.stringify(parsed)) {
    throw new Error("Stored rule book is not canonical.");
  }
  return parsed;
};

export const projectRuleBook = (book: StoredRuleBook): RuleBookProjection => ({
  audit: book.audit,
  deployment: book.deployment,
  revision: book.revision,
  rules: book.rules,
  version: 1,
});
