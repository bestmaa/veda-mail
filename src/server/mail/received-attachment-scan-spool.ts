import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  prepareReceivedScanDirectory,
  receivedScanConfig,
  validReceivedScanScope,
  validateReceivedScanInput,
} from "@/server/mail/received-attachment-scan-config";
import { createReceivedAttachmentReadStream } from "@/server/mail/received-attachment-scan-read";
import type { ReceivedScanRecord } from "@/server/mail/received-attachment-scan-record";
import { receivedScanSnapshot } from "@/server/mail/received-attachment-scan-record";
import {
  deleteReceivedScanFile,
  receivedScanIsTerminal,
} from "@/server/mail/received-attachment-scan-retire";
import { stageReceivedAttachment } from "@/server/mail/received-attachment-scan-stage";
import {
  type ReceivedAttachmentScanHandle,
  type ReceivedAttachmentScanScope,
  type ReceivedAttachmentScanSpoolOptions,
  ReceivedAttachmentScanError,
  receivedScanError,
  type ReceivedAttachmentScanState,
  type StageReceivedAttachmentInput,
} from "@/server/mail/received-attachment-scan-types";

export class ReceivedAttachmentScanSpool {
  readonly #directory: string;
  readonly #idleTimeoutMs: number;
  readonly #key: Buffer;
  readonly #maxBytes: number;
  readonly #maxGlobalBytes: number;
  readonly #maxGlobalRecords: number;
  readonly #now: () => number;
  readonly #onStateChange:
    ((state: ReceivedAttachmentScanState) => void) | undefined;
  readonly #operationTimeoutMs: number;
  readonly #records = new Map<string, ReceivedScanRecord>();
  readonly #scanner: ReceivedAttachmentScanSpoolOptions["scanner"];
  readonly #serveTimeoutMs: number;
  readonly #ttlMs: number;
  #reservedBytes = 0;
  private constructor(options: ReceivedAttachmentScanSpoolOptions) {
    const config = receivedScanConfig(options);
    this.#directory = options.directory;
    this.#key = config.key;
    this.#maxBytes = config.maxBytes;
    this.#maxGlobalBytes = config.maxGlobalBytes;
    this.#maxGlobalRecords = config.maxGlobalRecords;
    this.#idleTimeoutMs = config.idleTimeoutMs;
    this.#operationTimeoutMs = config.operationTimeoutMs;
    this.#serveTimeoutMs = config.serveTimeoutMs;
    this.#ttlMs = config.ttlMs;
    this.#now = config.now;
    this.#onStateChange = config.onStateChange;
    this.#scanner = options.scanner;
  }

  public async stage(input: StageReceivedAttachmentInput): Promise<ReceivedAttachmentScanHandle> {
    await this.cleanupExpired();
    validateReceivedScanInput(input, this.#maxBytes);
    const reserved = this.#maxBytes;
    if (
      this.#records.size >= this.#maxGlobalRecords ||
      reserved > this.#maxGlobalBytes - this.#reservedBytes
    ) throw receivedScanError("quota_exceeded");
    const record: ReceivedScanRecord = {
      binding: this.#binding(input.scope),
      byteLength: 0,
      chunkCount: 0,
      controller: undefined,
      expiresAt: this.#now() + this.#ttlMs,
      fileName: "",
      id: randomBytes(24).toString("base64url"),
      reservedBytes: reserved,
      sha256: "",
      state: "staging",
    };
    this.#records.set(record.id, record);
    this.#reservedBytes += reserved;
    this.#onStateChange?.(record.state);
    const controller = new AbortController();
    record.controller = controller;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(
      () => controller.abort(receivedScanError("timeout")),
      this.#operationTimeoutMs,
    );
    timeout.unref();
    const progress = (): void => {
      clearTimeout(idle);
      idle = setTimeout(
        () => controller.abort(receivedScanError("timeout")),
        this.#idleTimeoutMs,
      );
      idle.unref();
    };
    const externalAbort = (): void =>
      controller.abort(receivedScanError("aborted"));
    input.signal?.addEventListener("abort", externalAbort, { once: true });
    if (input.signal?.aborted) externalAbort();
    progress();
    try {
      const result = await stageReceivedAttachment({
        binding: record.binding,
        body: input.body,
        directory: this.#directory,
        expectedBytes: input.expectedBytes,
        key: this.#key,
        maxBytes: this.#maxBytes,
        onCleanupFailure: (fileName) => {
          record.fileName = fileName;
        },
        onComplete: () => this.#setState(record, "scanning"),
        onProgress: progress,
        recordId: record.id,
        scanner: this.#scanner,
        signal: controller.signal,
      });
      if (!this.#records.has(record.id)) throw receivedScanError("expired");
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? receivedScanError("aborted");
      }
      if (record.expiresAt <= this.#now()) throw receivedScanError("expired");
      this.#reservedBytes -= record.reservedBytes - result.byteLength;
      Object.assign(record, result, {
        controller: undefined,
        expiresAt: this.#now() + this.#ttlMs,
        reservedBytes: result.byteLength,
      });
      this.#setState(record, "clean");
      return this.#handle(record);
    } catch (error) {
      await this.#consume(
        record,
        error instanceof ReceivedAttachmentScanError &&
          error.code === "expired" ? "expired" : "rejected",
      );
      if (error instanceof ReceivedAttachmentScanError) throw error;
      throw receivedScanError("storage_unavailable");
    } finally {
      clearTimeout(idle);
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", externalAbort);
      record.controller = undefined;
    }
  }

  public async cleanupExpired(): Promise<number> {
    const expired = [...this.#records.values()].filter(
      (record) =>
        receivedScanIsTerminal(record.state) ||
        record.expiresAt <= this.#now(),
    );
    for (const record of expired) {
      record.controller?.abort(receivedScanError("expired"));
      await this.#consume(record, "expired");
    }
    return expired.length;
  }

  public stats(): { readonly bytes: number; readonly records: number } {
    return { bytes: this.#reservedBytes, records: this.#records.size };
  }

  public async dispose(): Promise<void> {
    await Promise.all([...this.#records.values()].map(async (record) => {
      record.controller?.abort(receivedScanError("aborted"));
      await this.#consume(record, "consumed");
    }));
  }

  #binding(scope: ReceivedAttachmentScanScope): string {
    const hmac = createHmac("sha256", this.#key);
    for (const value of [
      scope.connectionId,
      scope.messageId,
      scope.attachmentId,
    ]) hmac.update(String(Buffer.byteLength(value))).update(":" + value);
    return hmac.digest("base64url");
  }

  #consume = async (
    record: ReceivedScanRecord,
    state: "consumed" | "expired" | "rejected",
  ): Promise<void> => {
    if (this.#records.get(record.id) !== record) return;
    if (!receivedScanIsTerminal(record.state)) this.#setState(record, state);
    if (!(await deleteReceivedScanFile(this.#directory, record.fileName))) return;
    if (!this.#records.delete(record.id)) return;
    this.#reservedBytes -= record.reservedBytes;
  };

  #handle(record: ReceivedScanRecord): ReceivedAttachmentScanHandle {
    return {
      dispose: () => this.#consume(record, "consumed"),
      serve: (scope, signal) => this.#serve(record, scope, signal),
      get snapshot() {
        return receivedScanSnapshot(record);
      },
    };
  }

  async #serve(
    record: ReceivedScanRecord,
    scope: ReceivedAttachmentScanScope,
    signal?: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    await this.cleanupExpired();
    if (!validReceivedScanScope(scope)) throw receivedScanError("scope_mismatch");
    const supplied = Buffer.from(this.#binding(scope));
    const expected = Buffer.from(record.binding);
    if (
      supplied.byteLength !== expected.byteLength ||
      !timingSafeEqual(supplied, expected)
    ) throw receivedScanError("scope_mismatch");
    if (record.state === "expired") throw receivedScanError("expired");
    if (record.state !== "clean" || this.#records.get(record.id) !== record) {
      throw receivedScanError("state_conflict");
    }
    this.#setState(record, "serving");
    try {
      return await createReceivedAttachmentReadStream({
        directory: this.#directory,
        key: this.#key,
        now: this.#now,
        onConsume: this.#consume,
        record,
        scopeBinding: record.binding,
        serveTimeoutMs: this.#serveTimeoutMs,
      }, signal);
    } catch (error) {
      await this.#consume(record, "rejected");
      if (error instanceof ReceivedAttachmentScanError) throw error;
      throw receivedScanError("corrupt");
    }
  }
  #setState(record: ReceivedScanRecord, state: ReceivedAttachmentScanState) {
    record.state = state;
    this.#onStateChange?.(state);
  }
  public static async create(options: ReceivedAttachmentScanSpoolOptions) {
    await prepareReceivedScanDirectory(options.directory);
    return new ReceivedAttachmentScanSpool(options);
  }
}

export const createReceivedAttachmentScanSpool = ReceivedAttachmentScanSpool.create;
