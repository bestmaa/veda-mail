import "server-only";

import { defaultAttachmentQuotas } from "@/server/attachments";
import { ApiError } from "@/transport/http/api-error";

const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_WAITERS = 32;

export interface AttachmentSendMemoryLease {
  release(): void;
}

export interface AttachmentSendMemoryBudgetOptions {
  readonly capacityBytes: number;
  readonly maxWaiters?: number;
  readonly waitTimeoutMs?: number;
}

interface MemoryWaiter {
  readonly abortError: () => Error;
  readonly busyError: () => ApiError;
  readonly bytes: number;
  readonly reject: (error: Error) => void;
  readonly resolve: (lease: AttachmentSendMemoryLease) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
  settled: boolean;
  timeout?: NodeJS.Timeout;
}

const sendBusyError = (): ApiError =>
  new ApiError(
    "Attachment sending is busy. Please wait and try again.",
    "ATTACHMENT_SEND_BUSY",
    503,
  );

export interface AttachmentMemoryAcquireOptions {
  readonly abortError?: () => Error;
  readonly busyError?: () => ApiError;
  readonly signal?: AbortSignal;
}

const assertPositiveSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
};

export class AttachmentSendMemoryBudget {
  readonly #capacityBytes: number;
  readonly #maxWaiters: number;
  readonly #waitTimeoutMs: number;
  #inUseBytes = 0;
  readonly #waiters: MemoryWaiter[] = [];

  public constructor(options: AttachmentSendMemoryBudgetOptions) {
    assertPositiveSafeInteger(options.capacityBytes, "Memory capacity");
    assertPositiveSafeInteger(
      options.maxWaiters ?? DEFAULT_MAX_WAITERS,
      "Maximum waiter count",
    );
    assertPositiveSafeInteger(
      options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      "Memory wait timeout",
    );
    this.#capacityBytes = options.capacityBytes;
    this.#maxWaiters = options.maxWaiters ?? DEFAULT_MAX_WAITERS;
    this.#waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  }

  public async acquire(
    bytes: number,
    options: AttachmentMemoryAcquireOptions = {},
  ): Promise<AttachmentSendMemoryLease> {
    assertPositiveSafeInteger(bytes, "Attachment memory request");
    const abortError = options.abortError ?? (() => new Error("Aborted."));
    const busyError = options.busyError ?? sendBusyError;
    if (options.signal?.aborted) throw abortError();
    if (bytes > this.#capacityBytes) throw busyError();
    if (
      this.#waiters.length === 0 &&
      bytes <= this.#capacityBytes - this.#inUseBytes
    ) {
      return this.#createLease(bytes);
    }
    if (this.#waiters.length >= this.#maxWaiters) throw busyError();
    return new Promise<AttachmentSendMemoryLease>((resolve, reject) => {
      const waiter: MemoryWaiter = {
        abortError,
        busyError,
        bytes,
        reject,
        resolve,
        ...(options.signal ? { signal: options.signal } : {}),
        settled: false,
      };
      this.#waiters.push(waiter);
      waiter.abort = () => this.#rejectWaiter(waiter, waiter.abortError());
      waiter.timeout = setTimeout(() => {
        this.#rejectWaiter(waiter, waiter.busyError());
      }, this.#waitTimeoutMs);
      waiter.timeout.unref();
      waiter.signal?.addEventListener("abort", waiter.abort, { once: true });
      if (waiter.signal?.aborted) waiter.abort();
    });
  }

  #createLease(bytes: number): AttachmentSendMemoryLease {
    this.#inUseBytes += bytes;
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        this.#inUseBytes -= bytes;
        this.#drain();
      },
    });
  }

  #drain(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters[0];
      if (!waiter || waiter.bytes > this.#capacityBytes - this.#inUseBytes) {
        return;
      }
      this.#waiters.shift();
      if (waiter.settled) continue;
      waiter.settled = true;
      this.#cleanupWaiter(waiter);
      waiter.resolve(this.#createLease(waiter.bytes));
    }
  }

  #cleanupWaiter(waiter: MemoryWaiter): void {
    if (waiter.timeout) clearTimeout(waiter.timeout);
    if (waiter.abort) {
      waiter.signal?.removeEventListener("abort", waiter.abort);
    }
  }

  #rejectWaiter(waiter: MemoryWaiter, error: Error): void {
    if (waiter.settled) return;
    waiter.settled = true;
    const index = this.#waiters.indexOf(waiter);
    if (index >= 0) this.#waiters.splice(index, 1);
    this.#cleanupWaiter(waiter);
    waiter.reject(error);
    this.#drain();
  }
}

const processState = globalThis as typeof globalThis & {
  __vedaMailAttachmentSendMemoryBudget?: AttachmentSendMemoryBudget;
};

export const attachmentSendMemoryBudget = (): AttachmentSendMemoryBudget => {
  processState.__vedaMailAttachmentSendMemoryBudget ??=
    new AttachmentSendMemoryBudget({
      capacityBytes: defaultAttachmentQuotas.maxAggregateBytesPerDraft,
    });
  return processState.__vedaMailAttachmentSendMemoryBudget;
};
