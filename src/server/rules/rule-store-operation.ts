import type {
  MailRuleDefinition,
  MailRulePutOperation,
  RuleDeploymentResult,
} from "@/domain/mail/rule";
import type { ProviderConnection } from "@/domain/provider/provider";

export type RuleDeploymentFinalize = RuleDeploymentResult | {
  readonly errorCode: string;
  readonly status: "conflict" | "failed";
};

export type RuleDeploymentOperation = {
  readonly connection: ProviderConnection;
  readonly expectedRevision: string;
  readonly operation: "persist-deployment-intent";
} | {
  readonly expectedRevision: string;
  readonly intentId: string;
  readonly operation: "finalize-deployment";
  readonly result: RuleDeploymentFinalize;
};

export type RuleStoreOperation = MailRulePutOperation | {
  readonly definitions: readonly MailRuleDefinition[];
  readonly expectedRevision: string | null;
  readonly operation: "replace-from-import";
} | RuleDeploymentOperation;
