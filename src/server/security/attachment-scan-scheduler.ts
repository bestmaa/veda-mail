import "server-only";

import {
  AttachmentQuarantineError,
  type AttachmentScanner,
} from "@/server/attachments";

const DEFAULT_MAX_ACTIVE_SCANS = 4;
const DEFAULT_MAX_WAITERS = 32;
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

interface SchedulerOptions {
  readonly maxActive?: number;
  readonly maxWaiters?: number;
  readonly waitTimeoutMs?: number;
}

interface Waiter {
  readonly reject: (error: Error) => void;
  readonly resolve: () => void;
  settled: boolean;
  cleanup: () => void;
}

const busyError = () =>
  new AttachmentQuarantineError(
    "Attachment scanning is temporarily busy. Try again.",
    "ATTACHMENT_SCANNER_BUSY",
    503,
  );

const abortedError = () =>
  new AttachmentQuarantineError(
    "Attachment scanning was cancelled.",
    "ATTACHMENT_SCAN_ABORTED",
    409,
  );

const positiveInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
};

export class AttachmentScanScheduler {
  private readonly maxActive: number;
  private readonly maxWaiters: number;
  private readonly waitTimeoutMs: number;
  private active = 0;
  private readonly waiters: Waiter[] = [];

  public constructor(options: SchedulerOptions = {}) {
    this.maxActive = positiveInteger(
      options.maxActive ?? DEFAULT_MAX_ACTIVE_SCANS,
      "Maximum active scans",
    );
    this.maxWaiters = positiveInteger(
      options.maxWaiters ?? DEFAULT_MAX_WAITERS,
      "Maximum waiting scans",
    );
    this.waitTimeoutMs = positiveInteger(
      options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
      "Scan wait timeout",
    );
  }

  public async run<T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortedError();
    if (this.active < this.maxActive) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maxWaiters) throw busyError();

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        cleanup: () => undefined,
        reject,
        resolve,
        settled: false,
      };
      const remove = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      const fail = (error: Error) => {
        if (waiter.settled) return;
        waiter.settled = true;
        waiter.cleanup();
        remove();
        reject(error);
      };
      const onAbort = () => fail(abortedError());
      const timer = setTimeout(() => fail(busyError()), this.waitTimeoutMs);
      timer.unref();
      waiter.cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    this.active -= 1;
    while (this.active < this.maxActive) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.settled) continue;
      waiter.settled = true;
      waiter.cleanup();
      this.active += 1;
      waiter.resolve();
    }
  }
}

const schedulerGlobal = globalThis as typeof globalThis & {
  __vedaMailAttachmentScanScheduler?: AttachmentScanScheduler;
};

export const processAttachmentScanScheduler = (): AttachmentScanScheduler => {
  schedulerGlobal.__vedaMailAttachmentScanScheduler ??=
    new AttachmentScanScheduler();
  return schedulerGlobal.__vedaMailAttachmentScanScheduler;
};

export const scheduleAttachmentScanner = (
  scanner: AttachmentScanner,
  scheduler = processAttachmentScanScheduler(),
): AttachmentScanner => ({
  scan: (content, context) =>
    scheduler.run(context.signal, () => scanner.scan(content, context)),
});
