import "server-only";

const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The provider operation was cancelled.", "AbortError");

export const rejectIfProviderOperationAborted = (
  signal?: AbortSignal,
): void => {
  if (signal?.aborted) throw abortReason(signal);
};

export const providerOperationSignal = (
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

export const awaitProviderOperation = async <T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
