import "server-only";

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";

import {
  decryptScanChunk,
  readExact,
  RECEIVED_SCAN_CHUNK_BYTES,
  RECEIVED_SCAN_HEADER_BYTES,
  RECEIVED_SCAN_MAGIC,
  RECEIVED_SCAN_NONCE_BYTES,
  RECEIVED_SCAN_TAG_BYTES,
} from "@/server/mail/received-attachment-scan-crypto";
import type { ReceivedScanReadContext } from "@/server/mail/received-attachment-scan-record";
import {
  ReceivedAttachmentScanError,
  receivedScanError,
} from "@/server/mail/received-attachment-scan-types";

const SAFE_FILE_NAME = /^[A-Za-z0-9_-]{32}\.vrs$/;

const safeReadError = (error: unknown): ReceivedAttachmentScanError =>
  error instanceof ReceivedAttachmentScanError
    ? error
    : receivedScanError("corrupt");

export const createReceivedAttachmentReadStream = async (
  context: ReceivedScanReadContext,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> => {
  if (!SAFE_FILE_NAME.test(context.record.fileName)) {
    throw receivedScanError("corrupt");
  }
  const handle = await open(
    path.join(context.directory, context.record.fileName),
    "r",
  ).catch(() => {
    throw receivedScanError("corrupt");
  });
  let header: Buffer;
  try {
    header = await readExact(handle, RECEIVED_SCAN_HEADER_BYTES, 0);
    if (!header.subarray(0, RECEIVED_SCAN_MAGIC.byteLength).equals(
      RECEIVED_SCAN_MAGIC,
    )) throw receivedScanError("corrupt");
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw safeReadError(error);
  }
  const nonce = header.subarray(
    RECEIVED_SCAN_MAGIC.byteLength,
    RECEIVED_SCAN_MAGIC.byteLength + RECEIVED_SCAN_NONCE_BYTES,
  );
  const hash = createHash("sha256");
  let position = RECEIVED_SCAN_HEADER_BYTES;
  let index = 0;
  let total = 0;
  let settled = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const consume = async (
    state: "consumed" | "expired" | "rejected",
  ): Promise<void> => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await handle.close().catch(() => undefined);
    await context.onConsume(context.record, state);
  };
  const fail = (error: ReceivedAttachmentScanError): void => {
    if (settled) return;
    void consume(error.code === "corrupt" ? "rejected" : "consumed").then(
      () => controller?.error(error),
    );
  };
  const abort = (): void => fail(receivedScanError("aborted"));
  const timer = setTimeout(
    () => fail(receivedScanError("timeout")),
    context.serveTimeoutMs,
  );
  timer.unref();
  signal?.addEventListener("abort", abort, { once: true });
  const verifyEnd = async (): Promise<void> => {
    const details = await handle.stat();
    if (
      details.size !== position ||
      total !== context.record.byteLength ||
      hash.digest("hex") !== context.record.sha256
    ) throw receivedScanError("corrupt");
  };
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    async pull(streamController) {
      if (settled) return;
      try {
        if (context.now() >= context.record.expiresAt) {
          throw receivedScanError("expired");
        }
        if (index === context.record.chunkCount) {
          await verifyEnd();
          await consume("consumed");
          streamController.close();
          return;
        }
        const lengthBytes = await readExact(handle, 4, position);
        position += 4;
        const length = lengthBytes.readUInt32BE();
        if (
          length < 1 || length > RECEIVED_SCAN_CHUNK_BYTES ||
          length > context.record.byteLength - total
        ) throw receivedScanError("corrupt");
        const ciphertext = await readExact(handle, length, position);
        position += length;
        const tag = await readExact(handle, RECEIVED_SCAN_TAG_BYTES, position);
        position += RECEIVED_SCAN_TAG_BYTES;
        const plaintext = decryptScanChunk({
          binding: context.scopeBinding,
          ciphertext,
          index,
          key: context.key,
          nonce,
          plainLength: length,
          recordId: context.record.id,
          tag,
        });
        index += 1;
        total += plaintext.byteLength;
        hash.update(plaintext);
        if (index === context.record.chunkCount) await verifyEnd();
        if (settled) return;
        streamController.enqueue(plaintext);
        if (index === context.record.chunkCount) {
          await consume("consumed");
          streamController.close();
        }
      } catch (error) {
        if (settled) return;
        const safe = safeReadError(error);
        await consume(safe.code === "expired" ? "expired" : "rejected");
        streamController.error(safe);
      }
    },
    async cancel() {
      await consume("consumed");
    },
  }, { highWaterMark: 0 });
  if (signal?.aborted) abort();
  return stream;
};
