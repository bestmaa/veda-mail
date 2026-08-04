import "server-only";

export type ManageSieveErrorCode =
  | "RULE_PROVIDER_CONFLICT"
  | "RULE_PROVIDER_REJECTED"
  | "RULE_PROVIDER_UNSUPPORTED";

export class ManageSieveError extends Error {
  public constructor(
    public readonly code: ManageSieveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ManageSieveError";
  }
}

export const manageSieveConflict = (message: string): never => {
  throw new ManageSieveError("RULE_PROVIDER_CONFLICT", message);
};

export const manageSieveRejected = (): never => {
  throw new ManageSieveError(
    "RULE_PROVIDER_REJECTED",
    "The mail provider rejected the rules script.",
  );
};

export const manageSieveUnsupported = (message: string): never => {
  throw new ManageSieveError("RULE_PROVIDER_UNSUPPORTED", message);
};
