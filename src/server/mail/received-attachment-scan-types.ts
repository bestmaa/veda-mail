import "server-only";

import type { AttachmentScanner } from "@/server/attachments";

export const MAX_RECEIVED_SCAN_BYTES = 50 * 1024 * 1024;
export const DEFAULT_RECEIVED_SCAN_GLOBAL_BYTES = 512 * 1024 * 1024;
export const DEFAULT_RECEIVED_SCAN_GLOBAL_RECORDS = 1_000;

export const receivedScanStates = [
  "staging",
  "scanning",
  "clean",
  "serving",
  "consumed",
  "rejected",
  "expired",
] as const;

export type ReceivedAttachmentScanState =
  (typeof receivedScanStates)[number];

export interface ReceivedAttachmentScanScope {
  readonly attachmentId: string;
  readonly connectionId: string;
  readonly messageId: string;
}

export interface ReceivedAttachmentScanSnapshot {
  readonly byteLength: number;
  readonly expiresAt: string;
  readonly id: string;
  readonly sha256: string;
  readonly state: ReceivedAttachmentScanState;
}

export interface ReceivedAttachmentScanHandle {
  readonly snapshot: ReceivedAttachmentScanSnapshot;
  dispose(): Promise<void>;
  serve(
    scope: ReceivedAttachmentScanScope,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface ReceivedAttachmentScanSpoolOptions {
  readonly directory: string;
  readonly encryptionKey?: Uint8Array;
  readonly idleTimeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxGlobalBytes?: number;
  readonly maxGlobalRecords?: number;
  readonly now?: () => number;
  readonly onStateChange?: (
    state: ReceivedAttachmentScanState,
  ) => void;
  readonly operationTimeoutMs?: number;
  readonly scanner: AttachmentScanner;
  readonly serveTimeoutMs?: number;
  readonly ttlMs?: number;
}

export interface StageReceivedAttachmentInput {
  readonly body: ReadableStream<Uint8Array>;
  readonly expectedBytes: number | null;
  readonly scope: ReceivedAttachmentScanScope;
  readonly signal?: AbortSignal;
}

export type ReceivedAttachmentScanErrorCode =
  | "aborted"
  | "corrupt"
  | "expired"
  | "infected"
  | "invalid_input"
  | "length_mismatch"
  | "quota_exceeded"
  | "scan_incomplete"
  | "scanner_unavailable"
  | "scope_mismatch"
  | "size_limit_exceeded"
  | "state_conflict"
  | "storage_unavailable"
  | "timeout";

export class ReceivedAttachmentScanError extends Error {
  public constructor(
    public readonly code: ReceivedAttachmentScanErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ReceivedAttachmentScanError";
  }
}

export const receivedScanError = (
  code: ReceivedAttachmentScanErrorCode,
): ReceivedAttachmentScanError => {
  const errors: Record<
    ReceivedAttachmentScanErrorCode,
    readonly [message: string, status: number]
  > = {
    aborted: ["The attachment inspection was cancelled.", 499],
    corrupt: ["The inspected attachment could not be verified.", 502],
    expired: ["The inspected attachment expired.", 410],
    infected: ["The attachment was rejected by malware scanning.", 422],
    invalid_input: ["The attachment inspection request is invalid.", 400],
    length_mismatch: ["The provider returned an incomplete attachment.", 502],
    quota_exceeded: ["Attachment inspection capacity is unavailable.", 429],
    scan_incomplete: ["The scanner did not inspect the complete attachment.", 503],
    scanner_unavailable: ["The attachment scanner is unavailable.", 503],
    scope_mismatch: ["The inspected attachment is unavailable.", 404],
    size_limit_exceeded: ["The attachment is too large to inspect.", 413],
    state_conflict: ["The inspected attachment is no longer available.", 409],
    storage_unavailable: ["Attachment inspection storage is unavailable.", 503],
    timeout: ["The attachment inspection timed out.", 504],
  };
  const [message, status] = errors[code];
  return new ReceivedAttachmentScanError(code, message, status);
};
