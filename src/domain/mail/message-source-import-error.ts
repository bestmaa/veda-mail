export type MessageSourceImportErrorCode =
  | "aborted"
  | "invalid_request"
  | "mailbox_forbidden"
  | "mailbox_not_found"
  | "provider_failure"
  | "provider_rejected"
  | "size_limit_exceeded";

export class MessageSourceImportError extends Error {
  public override readonly name = "MessageSourceImportError";

  public constructor(
    public readonly code: MessageSourceImportErrorCode,
    message: string,
  ) {
    super(message);
  }
}
