export type AttachmentDownloadErrorCode =
  | "aborted"
  | "invalid_request"
  | "not_found"
  | "provider_failure"
  | "size_limit_exceeded"
  | "timeout";

export class AttachmentDownloadError extends Error {
  public override readonly name = "AttachmentDownloadError";

  public constructor(
    public readonly code: AttachmentDownloadErrorCode,
    message: string,
  ) {
    super(message);
  }
}
