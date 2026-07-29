export const attachmentStates = [
  "reserved",
  "uploading",
  "quarantined",
  "clean",
  "rejected",
  "claimed",
  "consumed",
] as const;

export type AttachmentState = (typeof attachmentStates)[number];

export interface AttachmentScope {
  readonly connectionId: string;
  readonly draftId: string;
  readonly ownerId: string;
  readonly sessionId: string;
}

export interface AttachmentReservation {
  readonly contentLength: number;
  readonly declaredMimeType: string;
  readonly fileName: string;
  readonly scope: AttachmentScope;
}

export interface AttachmentSnapshot {
  readonly contentLength: number;
  readonly createdAt: string;
  readonly detectedMimeType?: string;
  readonly expiresAt: string;
  readonly fileName: string;
  readonly id: string;
  readonly state: AttachmentState;
}

export interface AttachmentQuotas {
  readonly maxAggregateBytesPerDraft: number;
  readonly maxBytesPerSession: number;
  readonly maxFileBytes: number;
  readonly maxFilesPerDraft: number;
  readonly maxGlobalBytes: number;
  readonly maxGlobalRecords: number;
}

export const defaultAttachmentQuotas: AttachmentQuotas = {
  maxAggregateBytesPerDraft: 18 * 1024 * 1024,
  maxBytesPerSession: 36 * 1024 * 1024,
  maxFileBytes: 18 * 1024 * 1024,
  maxFilesPerDraft: 10,
  maxGlobalBytes: 512 * 1024 * 1024,
  maxGlobalRecords: 1_000,
};

export type AttachmentBody =
  AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

export interface AttachmentScanContext {
  readonly abortUpload: () => void;
  readonly attachmentId: string;
  readonly expectedBytes: number;
  readonly signal: AbortSignal;
}

export type AttachmentScanResult =
  | { readonly verdict: "clean" }
  | { readonly reason?: string; readonly verdict: "infected" };

export interface AttachmentScanner {
  scan(
    content: AsyncIterable<Uint8Array>,
    context: AttachmentScanContext,
  ): Promise<AttachmentScanResult>;
}

export interface AttachmentMimeContext {
  readonly byteLength: number;
  readonly declaredMimeType: string;
  readonly fileName: string;
  readonly sample: Uint8Array;
}

export type AttachmentMimeResult =
  | { readonly mimeType: string; readonly verdict: "accepted" }
  | { readonly reason?: string; readonly verdict: "rejected" };

export interface AttachmentMimeDetector {
  detect(context: AttachmentMimeContext): Promise<AttachmentMimeResult>;
}

export interface AttachmentQuarantineOptions {
  readonly directory: string;
  readonly encryptionKey?: Uint8Array;
  readonly mimeDetector: AttachmentMimeDetector;
  readonly now?: () => number;
  readonly quotas?: Partial<AttachmentQuotas>;
  readonly scanner: AttachmentScanner;
  readonly ttlMs?: number;
  readonly uploadIdleTimeoutMs?: number;
  readonly uploadTimeoutMs?: number;
}

export class AttachmentQuarantineError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AttachmentQuarantineError";
  }
}
