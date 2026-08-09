export type MessageSourceDownloadErrorCode =
  | "aborted"
  | "invalid_request"
  | "not_found"
  | "provider_failure"
  | "size_limit_exceeded";

export class MessageSourceDownloadError extends Error {
  public override readonly name = "MessageSourceDownloadError";

  public constructor(
    public readonly code: MessageSourceDownloadErrorCode,
    message: string,
  ) {
    super(message);
  }
}
