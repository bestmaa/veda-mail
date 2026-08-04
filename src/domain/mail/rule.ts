import type { LabelId, MailboxId, MessageId } from "@/domain/shared/brand";

export const MAX_MAIL_RULES = 50;
export const MAX_MAIL_RULE_CONDITIONS = 10;
export const MAX_MAIL_RULE_ACTIONS = 8;
export const MAX_MAIL_RULE_NAME_CHARACTERS = 80;
export const MAX_MAIL_RULE_VALUE_CHARACTERS = 256;
export const MAX_MAIL_RULE_VALUE_BYTES = 1_024;
export const MAX_MAIL_RULE_REQUEST_BYTES = 128 * 1_024;
export const MAX_MAIL_RULE_PREVIEW_MESSAGES = 100;
export const MAX_MAIL_RULE_PREVIEW_HEADERS = 8;
export const MAX_MAIL_RULE_HEADER_NAME_CHARACTERS = 64;
export const MAX_MAIL_RULE_SIZE_BYTES = 1024 ** 4;

export type MailRuleAddressField = "cc" | "from" | "recipient" | "to";
export type MailRuleTextOperator = "contains" | "is";

export type MailRuleCondition =
  | {
      readonly field: MailRuleAddressField;
      readonly kind: "address";
      readonly operator: MailRuleTextOperator | "domain";
      readonly value: string;
    }
  | {
      readonly kind: "subject";
      readonly operator: MailRuleTextOperator;
      readonly value: string;
    }
  | {
      readonly kind: "header";
      readonly name: string;
      readonly operator: "exists";
    }
  | {
      readonly kind: "header";
      readonly name: string;
      readonly operator: MailRuleTextOperator;
      readonly value: string;
    }
  | {
      readonly bytes: number;
      readonly kind: "size";
      readonly operator: "over" | "under";
    }
  | { readonly kind: "attachment"; readonly value: true };

export type MailRuleAction =
  | { readonly kind: "move"; readonly mailboxId: MailboxId }
  | { readonly kind: "label"; readonly labelId: LabelId }
  | { readonly kind: "star" }
  | { readonly kind: "mark-read" }
  | { readonly kind: "discard" };

export interface MailRule {
  readonly actions: readonly MailRuleAction[];
  readonly conditions: readonly MailRuleCondition[];
  readonly createdAt: string;
  readonly enabled: boolean;
  readonly id: string;
  readonly match: "all" | "any";
  readonly name: string;
  readonly stopProcessing: boolean;
  readonly updatedAt: string;
}

export type MailRuleDefinition = Pick<
  MailRule,
  | "actions"
  | "conditions"
  | "enabled"
  | "match"
  | "name"
  | "stopProcessing"
>;

export type MailRulePutOperation =
  | {
      readonly definition: MailRuleDefinition;
      readonly expectedRevision: string | null;
      readonly operation: "create";
    }
  | {
      readonly definition: MailRuleDefinition;
      readonly expectedRevision: string | null;
      readonly operation: "update";
      readonly ruleId: string;
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "delete";
      readonly ruleId: string;
    }
  | {
      readonly enabled: boolean;
      readonly expectedRevision: string | null;
      readonly operation: "toggle";
      readonly ruleId: string;
    }
  | {
      readonly expectedRevision: string | null;
      readonly operation: "reorder";
      readonly ruleIds: readonly string[];
    };

export interface MailRuleBook {
  readonly revision: string | null;
  readonly rules: readonly MailRule[];
  readonly version: 1;
}

export interface MailRuleMessageFacts {
  readonly cc: readonly string[];
  readonly from: readonly string[];
  readonly hasAttachment: boolean;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly id: MessageId;
  readonly recipient: readonly string[];
  readonly size: number;
  readonly subject: string;
  readonly to: readonly string[];
}

export interface MailRulePlannedAction {
  readonly action: MailRuleAction;
  readonly ruleId: string;
}

export interface MailRuleEvaluation {
  readonly actions: readonly MailRulePlannedAction[];
  readonly matchedRuleIds: readonly string[];
  readonly stoppedByRuleId: string | null;
}

export type RuleConditionCapability =
  | MailRuleAddressField
  | "attachment"
  | "header"
  | "size"
  | "subject";
export type RuleActionCapability = MailRuleAction["kind"];

interface RuleCapabilityBase {
  readonly maxRules: number;
  readonly maxScriptBytes: number | null;
  readonly supportedActions: readonly RuleActionCapability[];
  readonly supportedConditions: readonly RuleConditionCapability[];
}

export type RuleCapability = RuleCapabilityBase & (
  | { readonly reason?: never; readonly supported: true }
  | { readonly reason: string; readonly supported: false }
);

export interface RuleDeploymentInput {
  readonly expectedProviderState: string | null;
  readonly rules: readonly MailRule[];
}

export interface RuleDeploymentResult {
  readonly providerState: string;
  readonly scriptHash: string;
  readonly scriptId: string;
  readonly status: "deployed";
}

export interface RulePreviewFact extends MailRuleMessageFacts {
  readonly receivedAt: string;
}

export interface RulePreviewResult {
  readonly evaluation: MailRuleEvaluation;
  readonly from: readonly string[];
  readonly messageId: MessageId;
  readonly receivedAt: string;
  readonly subject: string;
}

export interface RulePreviewInput {
  readonly limit: number;
  readonly rules: readonly MailRule[];
}

export const mailRuleActionIsTerminal = (action: MailRuleAction): boolean =>
  action.kind === "discard" || action.kind === "move";
