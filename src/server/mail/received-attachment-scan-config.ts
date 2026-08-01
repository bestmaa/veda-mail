import "server-only";

import { randomBytes } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";

import {
  DEFAULT_RECEIVED_SCAN_GLOBAL_BYTES,
  DEFAULT_RECEIVED_SCAN_GLOBAL_RECORDS,
  MAX_RECEIVED_SCAN_BYTES,
  type ReceivedAttachmentScanScope,
  type ReceivedAttachmentScanSpoolOptions,
  receivedScanError,
  type ReceivedAttachmentScanState,
  type StageReceivedAttachmentInput,
} from "@/server/mail/received-attachment-scan-types";

export interface ReceivedScanConfig {
  readonly idleTimeoutMs: number;
  readonly key: Buffer;
  readonly maxBytes: number;
  readonly maxGlobalBytes: number;
  readonly maxGlobalRecords: number;
  readonly now: () => number;
  readonly onStateChange:
    ((state: ReceivedAttachmentScanState) => void) | undefined;
  readonly operationTimeoutMs: number;
  readonly serveTimeoutMs: number;
  readonly ttlMs: number;
}

const positiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

export const receivedScanConfig = (
  options: ReceivedAttachmentScanSpoolOptions,
): ReceivedScanConfig => {
  const config: ReceivedScanConfig = {
    idleTimeoutMs: options.idleTimeoutMs ?? 30_000,
    key: Buffer.from(options.encryptionKey ?? randomBytes(32)),
    maxBytes: options.maxBytes ?? MAX_RECEIVED_SCAN_BYTES,
    maxGlobalBytes: options.maxGlobalBytes ??
      DEFAULT_RECEIVED_SCAN_GLOBAL_BYTES,
    maxGlobalRecords: options.maxGlobalRecords ??
      DEFAULT_RECEIVED_SCAN_GLOBAL_RECORDS,
    now: options.now ?? Date.now,
    onStateChange: options.onStateChange,
    operationTimeoutMs: options.operationTimeoutMs ?? 2 * 60_000,
    serveTimeoutMs: options.serveTimeoutMs ?? 2 * 60_000,
    ttlMs: options.ttlMs ?? 15 * 60_000,
  };
  if (
    config.key.byteLength !== 32 || !positiveInteger(config.maxBytes) ||
    config.maxBytes > MAX_RECEIVED_SCAN_BYTES ||
    !positiveInteger(config.maxGlobalBytes) ||
    !positiveInteger(config.maxGlobalRecords) ||
    !positiveInteger(config.idleTimeoutMs) ||
    !positiveInteger(config.operationTimeoutMs) ||
    !positiveInteger(config.serveTimeoutMs) || !positiveInteger(config.ttlMs)
  ) throw receivedScanError("invalid_input");
  return config;
};

export const validReceivedScanScope = (
  scope: ReceivedAttachmentScanScope,
): boolean => [scope?.attachmentId, scope?.connectionId, scope?.messageId]
  .every((value) =>
    typeof value === "string" && value.length > 0 && value.length <= 1_024,
  );

export const validateReceivedScanInput = (
  input: StageReceivedAttachmentInput,
  maxBytes: number,
): void => {
  if (
    typeof input?.body?.getReader !== "function" ||
    input.expectedBytes !== null &&
      (!Number.isSafeInteger(input.expectedBytes) ||
        input.expectedBytes < 0) ||
    !validReceivedScanScope(input.scope)
  ) throw receivedScanError("invalid_input");
  if (input.expectedBytes !== null && input.expectedBytes > maxBytes) {
    throw receivedScanError("size_limit_exceeded");
  }
};

export const prepareReceivedScanDirectory = async (
  directory: string,
): Promise<void> => {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  } catch {
    throw receivedScanError("storage_unavailable");
  }
};
