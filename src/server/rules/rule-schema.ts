import {
  MAX_MAIL_RULE_ACTIONS,
  MAX_MAIL_RULE_CONDITIONS,
  MAX_MAIL_RULE_HEADER_NAME_CHARACTERS,
  MAX_MAIL_RULE_NAME_CHARACTERS,
  MAX_MAIL_RULE_PREVIEW_MESSAGES,
  MAX_MAIL_RULE_SIZE_BYTES,
  MAX_MAIL_RULE_VALUE_BYTES,
  MAX_MAIL_RULE_VALUE_CHARACTERS,
  MAX_MAIL_RULES,
  type MailRule,
  type MailRuleBook,
  type MailRuleDefinition,
  type MailRulePutOperation,
  type RulePreviewInput,
} from "@/domain/mail/rule";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const canonicalText = (
  label: string,
  maximumCharacters: number,
  maximumBytes: number,
) => z.string().transform((value) => value.normalize("NFKC"))
  .superRefine((value, context) => {
    if (
      hasUnpairedContentSurrogate(value) ||
      hasDisallowedContentControl(value) ||
      /[\r\n\t\u2028\u2029]/u.test(value)
    ) {
      context.addIssue({
        code: "custom",
        message: `${label} contains unsafe characters.`,
      });
    }
  }).transform((value) => value.trim()).superRefine((value, context) => {
    if (!value) {
      context.addIssue({ code: "custom", message: `${label} cannot be blank.` });
    }
    if (
      value.length > maximumCharacters ||
      outgoingContentUtf8Bytes(value) > maximumBytes
    ) {
      context.addIssue({ code: "custom", message: `${label} is too long.` });
    }
  });

const valueSchema = canonicalText(
  "Rule value",
  MAX_MAIL_RULE_VALUE_CHARACTERS,
  MAX_MAIL_RULE_VALUE_BYTES,
);
const headerNameSchema = canonicalText(
  "Header name",
  MAX_MAIL_RULE_HEADER_NAME_CHARACTERS,
  MAX_MAIL_RULE_HEADER_NAME_CHARACTERS,
).transform((value) => value.toLowerCase()).refine(
  (value) => HEADER_NAME.test(value),
  "Header name is invalid.",
);

const addressConditionSchema = z.object({
  field: z.enum(["cc", "from", "recipient", "to"]),
  kind: z.literal("address"),
  operator: z.enum(["contains", "domain", "is"]),
  value: valueSchema,
}).strict().superRefine((condition, context) => {
  if (
    condition.operator === "domain" &&
    !DOMAIN.test(condition.value.toLowerCase())
  ) {
    context.addIssue({ code: "custom", message: "Rule domain is invalid." });
  }
});

const headerConditionSchema = z.discriminatedUnion("operator", [
  z.object({
    kind: z.literal("header"),
    name: headerNameSchema,
    operator: z.literal("exists"),
  }).strict(),
  z.object({
    kind: z.literal("header"),
    name: headerNameSchema,
    operator: z.enum(["contains", "is"]),
    value: valueSchema,
  }).strict(),
]);

export const mailRuleConditionSchema = z.discriminatedUnion("kind", [
  addressConditionSchema,
  z.object({
    kind: z.literal("subject"),
    operator: z.enum(["contains", "is"]),
    value: valueSchema,
  }).strict(),
  headerConditionSchema,
  z.object({
    bytes: z.number().int().min(1).max(MAX_MAIL_RULE_SIZE_BYTES),
    kind: z.literal("size"),
    operator: z.enum(["over", "under"]),
  }).strict(),
  z.object({ kind: z.literal("attachment"), value: z.literal(true) }).strict(),
]);

const mailRuleActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("move"),
    mailboxId: z.string().trim().min(1).max(1_024).transform(id.mailbox),
  }).strict(),
  z.object({
    kind: z.literal("label"),
    labelId: z.string().trim().min(1).max(200).transform(id.label),
  }).strict(),
  z.object({ kind: z.literal("star") }).strict(),
  z.object({ kind: z.literal("mark-read") }).strict(),
  z.object({ kind: z.literal("discard") }).strict(),
]);

const actionKey = (action: z.infer<typeof mailRuleActionSchema>): string =>
  action.kind === "move" ? `move:${action.mailboxId}`
    : action.kind === "label" ? `label:${action.labelId}` : action.kind;

const definitionFields = {
  actions: z.array(mailRuleActionSchema).min(1).max(MAX_MAIL_RULE_ACTIONS),
  conditions: z.array(mailRuleConditionSchema).min(1).max(MAX_MAIL_RULE_CONDITIONS),
  enabled: z.boolean(),
  match: z.enum(["all", "any"]),
  name: canonicalText("Rule name", MAX_MAIL_RULE_NAME_CHARACTERS, 320),
  stopProcessing: z.boolean(),
} as const;

const refineDefinition = (
  rule: z.infer<z.ZodObject<typeof definitionFields>>,
  context: z.RefinementCtx,
): void => {
  const keys = rule.actions.map(actionKey);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Rule actions must be unique." });
  }
  const terminal = rule.actions.filter(({ kind }) =>
    kind === "discard" || kind === "move");
  if (terminal.length > 1) {
    context.addIssue({ code: "custom", message: "A rule has one terminal action." });
  }
  if (terminal.length && !rule.stopProcessing) {
    context.addIssue({
      code: "custom",
      message: "Move and discard rules must stop later rules.",
    });
  }
  const conditions = rule.conditions.map((condition) => JSON.stringify(condition));
  if (new Set(conditions).size !== conditions.length) {
    context.addIssue({ code: "custom", message: "Rule conditions must be unique." });
  }
};

export const mailRuleDefinitionSchema = z.object(definitionFields).strict()
  .superRefine(refineDefinition);

export const mailRuleSchema = z.object({
  ...definitionFields,
  createdAt: z.string().datetime(),
  id: z.string().uuid().transform((value) => value.toLowerCase()),
  updatedAt: z.string().datetime(),
}).strict().superRefine((rule, context) => {
  refineDefinition(rule, context);
  if (Date.parse(rule.updatedAt) < Date.parse(rule.createdAt)) {
    context.addIssue({ code: "custom", message: "Rule timestamps are invalid." });
  }
});

export const mailRuleBookSchema = z.object({
  revision: z.string().trim().min(16).max(200).nullable(),
  rules: z.array(mailRuleSchema).max(MAX_MAIL_RULES),
  version: z.literal(1),
}).strict().superRefine((book, context) => {
  const ids = book.rules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Rule identifiers must be unique." });
  }
});

export const parseMailRule = (value: unknown): MailRule =>
  mailRuleSchema.parse(value) as MailRule;

export const parseMailRuleBook = (value: unknown): MailRuleBook =>
  mailRuleBookSchema.parse(value) as MailRuleBook;

const revisionSchema = z.string().trim().min(16).max(200).nullable();
const ruleIdSchema = z.string().uuid().transform((value) => value.toLowerCase());

export const mailRuleMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    definition: mailRuleDefinitionSchema,
    expectedRevision: revisionSchema,
    operation: z.literal("create"),
  }).strict(),
  z.object({
    definition: mailRuleDefinitionSchema,
    expectedRevision: revisionSchema,
    operation: z.literal("update"),
    ruleId: ruleIdSchema,
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    operation: z.literal("delete"),
    ruleId: ruleIdSchema,
  }).strict(),
  z.object({
    enabled: z.boolean(),
    expectedRevision: revisionSchema,
    operation: z.literal("toggle"),
    ruleId: ruleIdSchema,
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    operation: z.literal("reorder"),
    ruleIds: z.array(ruleIdSchema).max(MAX_MAIL_RULES),
  }).strict().superRefine((operation, context) => {
    if (new Set(operation.ruleIds).size !== operation.ruleIds.length) {
      context.addIssue({ code: "custom", message: "Rule order contains duplicates." });
    }
  }),
]);

export const parseMailRuleDefinition = (value: unknown): MailRuleDefinition =>
  mailRuleDefinitionSchema.parse(value) as MailRuleDefinition;

export const parseMailRulePutOperation = (value: unknown): MailRulePutOperation =>
  mailRuleMutationSchema.parse(value) as MailRulePutOperation;

const mailRulePreviewInputSchema = z.object({
  limit: z.number().int().min(1).max(MAX_MAIL_RULE_PREVIEW_MESSAGES),
  rules: z.array(mailRuleSchema).max(MAX_MAIL_RULES),
}).strict();

export const parseMailRulePreviewInput = (value: unknown): RulePreviewInput =>
  mailRulePreviewInputSchema.parse(value) as RulePreviewInput;
