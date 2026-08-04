import "server-only";

export type StalwartRuleErrorCode =
  | "RULE_PROVIDER_CONFLICT"
  | "RULE_PROVIDER_REJECTED"
  | "RULE_PROVIDER_UNSUPPORTED";

export class StalwartRuleError extends Error {
  public constructor(
    public readonly code: StalwartRuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StalwartRuleError";
  }
}

export const ruleConflict = (message: string): never => {
  throw new StalwartRuleError("RULE_PROVIDER_CONFLICT", message);
};

export const ruleRejected = (): never => {
  throw new StalwartRuleError(
    "RULE_PROVIDER_REJECTED",
    "The mail provider rejected the rules script.",
  );
};

export const ruleUnsupported = (message: string): never => {
  throw new StalwartRuleError("RULE_PROVIDER_UNSUPPORTED", message);
};
