import "server-only";

import type {
  ReceivedAttachmentScanSnapshot,
  ReceivedAttachmentScanState,
} from "@/server/mail/received-attachment-scan-types";

export interface ReceivedScanRecord {
  binding: string;
  byteLength: number;
  chunkCount: number;
  controller: AbortController | undefined;
  expiresAt: number;
  fileName: string;
  readonly id: string;
  reservedBytes: number;
  sha256: string;
  state: ReceivedAttachmentScanState;
}

export interface ReceivedScanReadContext {
  readonly directory: string;
  readonly key: Buffer;
  readonly now: () => number;
  readonly onConsume: (
    record: ReceivedScanRecord,
    state: "consumed" | "expired" | "rejected",
  ) => Promise<void>;
  readonly record: ReceivedScanRecord;
  readonly scopeBinding: string;
  readonly serveTimeoutMs: number;
}

export interface ReceivedScanStageResult {
  readonly byteLength: number;
  readonly chunkCount: number;
  readonly fileName: string;
  readonly sha256: string;
}

export const receivedScanSnapshot = (
  record: ReceivedScanRecord,
): ReceivedAttachmentScanSnapshot => Object.freeze({
  byteLength: record.byteLength,
  expiresAt: new Date(record.expiresAt).toISOString(),
  id: record.id,
  sha256: record.sha256,
  state: record.state,
});
