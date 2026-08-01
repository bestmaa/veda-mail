import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import type { AttachmentScanner } from "@/server/attachments";
import {
  RECEIVED_SCAN_CHUNK_BYTES,
  writeEncryptedScanChunk,
  writeScanHeader,
} from "@/server/mail/received-attachment-scan-crypto";
import type { ReceivedScanStageResult } from "@/server/mail/received-attachment-scan-record";
import {
  ReceivedAttachmentScanError,
  receivedScanError,
} from "@/server/mail/received-attachment-scan-types";

interface StageOptions {
  readonly binding: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly directory: string;
  readonly expectedBytes: number | null;
  readonly key: Buffer;
  readonly maxBytes: number;
  readonly onCleanupFailure: (fileName: string) => void;
  readonly onComplete: () => void;
  readonly onProgress: () => void;
  readonly recordId: string;
  readonly scanner: AttachmentScanner;
  readonly signal: AbortSignal;
}

const randomName = (suffix: string): string =>
  `${randomBytes(24).toString("base64url")}.${suffix}`;

const removeFailedFile = async (
  filePath: string,
  fileName: string,
  onFailure: (fileName: string) => void,
): Promise<void> => {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      onFailure(fileName);
    }
  }
};

const readWithAbort = <T>(operation: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(signal.reason ?? receivedScanError("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
    if (signal.aborted) abort();
  });

export const stageReceivedAttachment = async (
  options: StageOptions,
): Promise<ReceivedScanStageResult> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = options.body.getReader();
  } catch {
    throw receivedScanError("invalid_input");
  }
  const temporaryName = randomName("tmp");
  const finalName = randomName("vrs");
  const temporaryPath = path.join(options.directory, temporaryName);
  const finalPath = path.join(options.directory, finalName);
  const handle = await open(temporaryPath, "wx", 0o600).catch(() => {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw receivedScanError("storage_unavailable");
  });
  const hash = createHash("sha256");
  let byteLength = 0;
  let chunkCount = 0;
  let complete = false;
  let failed = true;
  let emptyChunks = 0;
  const cancel = (): void => {
    void reader.cancel(options.signal.reason).catch(() => undefined);
  };
  options.signal.addEventListener("abort", cancel, { once: true });
  try {
    const header = await writeScanHeader(handle);
    let position = header.position;
    const content = async function* (): AsyncGenerator<Uint8Array> {
      while (true) {
        const result = await readWithAbort(reader.read(), options.signal);
        if (result.done) break;
        if (!(result.value instanceof Uint8Array)) {
          throw receivedScanError("storage_unavailable");
        }
        if (result.value.byteLength === 0) {
          emptyChunks += 1;
          if (emptyChunks > 32) throw receivedScanError("storage_unavailable");
          continue;
        }
        for (
          let offset = 0;
          offset < result.value.byteLength;
          offset += RECEIVED_SCAN_CHUNK_BYTES
        ) {
          const part = Buffer.from(result.value.subarray(
            offset,
            Math.min(result.value.byteLength, offset + RECEIVED_SCAN_CHUNK_BYTES),
          ));
          if (part.byteLength > options.maxBytes - byteLength) {
            throw receivedScanError("size_limit_exceeded");
          }
          byteLength += part.byteLength;
          hash.update(part);
          position = await writeEncryptedScanChunk(handle, {
            binding: options.binding,
            bytes: part,
            index: chunkCount,
            key: options.key,
            nonce: header.nonce,
            position,
            recordId: options.recordId,
          });
          chunkCount += 1;
          options.onProgress();
          yield Buffer.from(part);
        }
      }
      if (
        options.expectedBytes !== null &&
        byteLength !== options.expectedBytes
      ) {
        throw receivedScanError("length_mismatch");
      }
      complete = true;
      options.onComplete();
    };
    let verdict: Awaited<ReturnType<AttachmentScanner["scan"]>>;
    try {
      verdict = await readWithAbort(options.scanner.scan(content(), {
        abortUpload: cancel,
        attachmentId: options.recordId,
        expectedBytes: options.expectedBytes ?? options.maxBytes,
        signal: options.signal,
      }), options.signal);
    } catch (error) {
      if (error instanceof ReceivedAttachmentScanError) throw error;
      throw receivedScanError(
        options.signal.aborted ? "aborted" : "scanner_unavailable",
      );
    }
    if (!complete) throw receivedScanError("scan_incomplete");
    if (verdict.verdict !== "clean") throw receivedScanError("infected");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    failed = false;
    return {
      byteLength,
      chunkCount,
      fileName: finalName,
      sha256: hash.digest("hex"),
    };
  } finally {
    options.signal.removeEventListener("abort", cancel);
    try {
      reader.releaseLock();
    } catch {
      // Cancellation can settle a provider-owned pending read later.
    }
    await handle.close().catch(() => undefined);
    if (failed) {
      cancel();
      await removeFailedFile(
        temporaryPath,
        temporaryName,
        options.onCleanupFailure,
      );
    }
  }
};
