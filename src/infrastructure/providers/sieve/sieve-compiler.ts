import "server-only";

import {
  MAX_MAIL_RULES,
  mailRuleActionIsTerminal,
  type MailRule,
  type MailRuleAction,
  type MailRuleCondition,
} from "@/domain/mail/rule";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
} from "@/domain/mail/outgoing-content-policy";

const MAX_SCRIPT_BYTES = 256 * 1024;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;
const LABEL_KEYWORD = /^veda-label-[a-z2-7]{26}$/u;

export interface SieveCompilerCapabilities {
  readonly extensions: readonly string[];
  readonly maxScriptBytes: number | null;
}

export interface SieveCompilerInput {
  readonly capabilities: SieveCompilerCapabilities;
  readonly mailboxNames: Readonly<Record<string, string>>;
  readonly rules: readonly MailRule[];
}

export interface CompiledSieveRules {
  readonly content: string;
  readonly requiredExtensions: readonly string[];
}

export class SieveRuleCompileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SieveRuleCompileError";
  }
}

export class SieveRuleCapabilityError extends SieveRuleCompileError {
  public constructor(public readonly extension: string) {
    super(`The mail server does not support the ${extension} Sieve extension.`);
    this.name = "SieveRuleCapabilityError";
  }
}

const safeText = (value: string, label: string): string => {
  if (
    !value || value !== value.normalize("NFKC") ||
    hasUnpairedContentSurrogate(value) || hasDisallowedContentControl(value) ||
    /[\r\n\t\u2028\u2029]/u.test(value)
  ) {
    throw new SieveRuleCompileError(`${label} is not canonical safe text.`);
  }
  return value;
};

const quoted = (value: string, label = "Sieve value"): string =>
  `"${safeText(value, label).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const conditionExtensions = (condition: MailRuleCondition): readonly string[] => {
  if (condition.kind === "attachment") {
    return ["foreverypart", "mime", "variables"];
  }
  if (condition.kind === "address" && condition.field === "recipient") {
    return ["envelope"];
  }
  return [];
};

const actionExtensions = (action: MailRuleAction): readonly string[] => {
  if (action.kind === "move") return ["fileinto"];
  if (["label", "mark-read", "star"].includes(action.kind)) {
    return ["imap4flags"];
  }
  return [];
};

const requiredExtensions = (rules: readonly MailRule[]): readonly string[] =>
  [...new Set(rules.filter(({ enabled }) => enabled).flatMap((rule) => [
    ...rule.conditions.flatMap(conditionExtensions),
    ...rule.actions.flatMap(actionExtensions),
  ]))].sort();

const assertCapabilities = (
  required: readonly string[],
  advertised: readonly string[],
): void => {
  const available = new Set(advertised.map((value) => value.toLowerCase()));
  for (const extension of required) {
    if (!available.has(extension)) throw new SieveRuleCapabilityError(extension);
  }
};

const addressTest = (
  condition: Extract<MailRuleCondition, { readonly kind: "address" }>,
): string => {
  const test = condition.field === "recipient" ? "envelope" : "address";
  const field = condition.field === "recipient" ? "to" : condition.field;
  const match = condition.operator === "domain"
    ? ":domain :is"
    : `:${condition.operator}`;
  return `${test} ${match} ${quoted(field)} ${quoted(condition.value)}`;
};

const conditionTest = (
  condition: MailRuleCondition,
  attachmentVariable: string,
): string => {
  if (condition.kind === "address") return addressTest(condition);
  if (condition.kind === "subject") {
    return `header :${condition.operator} "subject" ${quoted(condition.value)}`;
  }
  if (condition.kind === "header") {
    if (!HEADER_NAME.test(condition.name)) {
      throw new SieveRuleCompileError("Header name is invalid.");
    }
    if (condition.operator === "exists") return `exists ${quoted(condition.name)}`;
    return `header :${condition.operator} ${quoted(condition.name)} ${quoted(condition.value)}`;
  }
  if (condition.kind === "size") return `size :${condition.operator} ${condition.bytes}`;
  return `string :is "\${${attachmentVariable}}" "1"`;
};

const attachmentPrelude = (variable: string): readonly string[] => [
  `set ${quoted(variable)} "0";`,
  "foreverypart {",
  "  if anyof(",
  "    header :mime :is \"Content-Disposition\" \"attachment\",",
  "    header :mime :matches \"Content-Disposition\" [\"attachment;*\", \"attachment ;*\"],",
  "    header :mime :param \"filename\" :matches " +
    "[\"Content-Type\", \"Content-Disposition\"] \"?*\"",
  "  ) {",
  `    set ${quoted(variable)} "1";`,
  "    break;",
  "  }",
  "}",
];

const actionLine = (
  action: MailRuleAction,
  mailboxNames: Readonly<Record<string, string>>,
): string => {
  if (action.kind === "label") {
    if (!LABEL_KEYWORD.test(action.labelId)) {
      throw new SieveRuleCompileError("Label identifier is invalid.");
    }
    return `addflag ${quoted(action.labelId)};`;
  }
  if (action.kind === "star") return `addflag ${quoted("\\Flagged")};`;
  if (action.kind === "mark-read") return `addflag ${quoted("\\Seen")};`;
  if (action.kind === "discard") return "discard;";
  const mailbox = mailboxNames[action.mailboxId];
  if (!mailbox) throw new SieveRuleCompileError("Rule mailbox is unavailable.");
  return `fileinto ${quoted(mailbox, "Mailbox name")};`;
};

const actionRank = (action: MailRuleAction): number => {
  if (action.kind === "label") return 0;
  if (action.kind === "star") return 1;
  if (action.kind === "mark-read") return 2;
  return 3;
};

const orderedActions = (actions: readonly MailRuleAction[]) =>
  actions.map((action, index) => ({ action, index }))
    .sort((left, right) =>
      actionRank(left.action) - actionRank(right.action) || left.index - right.index)
    .map(({ action }) => action);

const compileRule = (
  rule: MailRule,
  index: number,
  mailboxNames: Readonly<Record<string, string>>,
): readonly string[] => {
  const attachmentVariable = `veda_attachment_${index}`;
  const hasAttachment = rule.conditions.some(({ kind }) => kind === "attachment");
  const tests = rule.conditions.map((condition) =>
    conditionTest(condition, attachmentVariable));
  const lines = hasAttachment ? [...attachmentPrelude(attachmentVariable)] : [];
  lines.push(`if ${rule.match}of(${tests.join(", ")}) {`);
  for (const action of orderedActions(rule.actions)) {
    lines.push(`  ${actionLine(action, mailboxNames)}`);
  }
  if (rule.stopProcessing || rule.actions.some(mailRuleActionIsTerminal)) {
    lines.push("  stop;");
  }
  lines.push("}");
  return lines;
};

export const compileMailRulesToSieveProgram = (
  input: SieveCompilerInput,
): CompiledSieveRules => {
  if (input.rules.length > MAX_MAIL_RULES) {
    throw new SieveRuleCompileError("Too many rules were supplied.");
  }
  const enabled = input.rules.filter(({ enabled }) => enabled);
  const required = requiredExtensions(enabled);
  assertCapabilities(required, input.capabilities.extensions);
  const lines = ["# Veda Mail generated rules v1. Do not edit."];
  if (required.length) lines.push(`require [${required.map((item) => quoted(item)).join(", ")}];`);
  enabled.forEach((rule, index) => {
    lines.push("", ...compileRule(rule, index, input.mailboxNames));
  });
  const script = `${lines.join("\r\n")}\r\n`;
  const providerLimit = input.capabilities.maxScriptBytes;
  const limit = providerLimit === null
    ? MAX_SCRIPT_BYTES
    : Math.min(MAX_SCRIPT_BYTES, providerLimit);
  if (!Number.isInteger(limit) || limit < 1 || new TextEncoder().encode(script).length > limit) {
    throw new SieveRuleCompileError("The generated Sieve script is too large.");
  }
  return { content: script, requiredExtensions: required };
};

export const compileMailRulesToSieve = (input: SieveCompilerInput): string =>
  compileMailRulesToSieveProgram(input).content;
