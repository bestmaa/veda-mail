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
  readonly bytes: number;
  readonly reject: (error: ApiError) => void;
  readonly resolve: (lease: AttachmentSendMemoryLease) => void;
  settled: boolean;
  timeout?: NodeJS.Timeout;
}

const busyError = (): ApiError =>
  new ApiError(
    "Attachment sending is busy. Please wait and try again.",
    "ATTACHMENT_SEND_BUSY",
    503,
  );

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

  public async acquire(bytes: number): Promise<AttachmentSendMemoryLease> {
    assertPositiveSafeInteger(bytes, "Attachment memory request");
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
        bytes,
        reject,
        resolve,
        settled: false,
      };
      waiter.timeout = setTimeout(() => {
        this.#expire(waiter);
      }, this.#waitTimeoutMs);
      waiter.timeout.unref();
      this.#waiters.push(waiter);
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
      if (waiter.timeout) clearTimeout(waiter.timeout);
      waiter.resolve(this.#createLease(waiter.bytes));
    }
  }

  #expire(waiter: MemoryWaiter): void {
    if (waiter.settled) return;
    waiter.settled = true;
    const index = this.#waiters.indexOf(waiter);
    if (index >= 0) this.#waiters.splice(index, 1);
    waiter.reject(busyError());
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
