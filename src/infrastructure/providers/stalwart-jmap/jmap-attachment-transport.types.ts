export type JmapAttachmentTransportErrorCode =
  | "aborted"
  | "authorization_failed"
  | "content_length_mismatch"
  | "endpoint_rejected"
  | "invalid_handle"
  | "invalid_input"
  | "invalid_provider_response"
  | "network_error"
  | "provider_http_error"
  | "redirect_rejected"
  | "scope_mismatch"
  | "size_limit_exceeded"
  | "timeout";

export class JmapAttachmentTransportError extends Error {
  public override readonly name = "JmapAttachmentTransportError";

  public constructor(
    public readonly code: JmapAttachmentTransportErrorCode,
    message: string,
    public readonly httpStatus: number | undefined = undefined,
  ) {
    super(message);
  }
}

export type JmapAttachmentRequestBody = Uint8Array | ReadableStream<Uint8Array>;

export interface JmapAttachmentTransportConfig {
  readonly authorizationHeader: () => Promise<string> | string;
  readonly baseUrl: string;
  readonly downloadUrl: string;
  readonly maxDownloadBytes: number;
  readonly maxUploadBytes: number;
  readonly operationTimeoutMs?: number;
  readonly uploadUrl: string;
}

export interface JmapPublicAttachment {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
}

export interface JmapAttachmentHandle extends JmapPublicAttachment {
  toJSON(): JmapPublicAttachment;
}

export interface JmapUploadAttachmentInput {
  readonly accountId: string;
  readonly body: JmapAttachmentRequestBody;
  readonly contentLength: number;
  readonly fileName: string;
  readonly mediaType: string;
  readonly signal?: AbortSignal;
}

export interface JmapBindMessageAttachmentInput {
  readonly accountId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly messageId: string;
  readonly providerBlobId: string;
  readonly size: number;
}

export interface JmapDownloadAttachmentInput {
  readonly attachment: JmapAttachmentHandle;
  readonly maxBytes?: number;
  readonly messageId: string;
  readonly signal?: AbortSignal;
}

export interface JmapDownloadedAttachment extends JmapPublicAttachment {
  readonly body: ReadableStream<Uint8Array>;
}

export interface JmapProviderUploadReference {
  readonly blobId: string;
  readonly size: number;
  readonly type: string;
}
