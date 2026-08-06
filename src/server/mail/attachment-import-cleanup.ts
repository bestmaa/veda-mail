import "server-only";

import { logError } from "@/server/observability/structured-log";

const CLEANUP_WAIT_MS = 250;

interface AttachmentImportCleanupInput {
  readonly body?: ReadableStream<Uint8Array>;
  readonly reason: unknown;
  readonly remove?: () => Promise<void>;
}

export const cleanupAttachmentImport = async (
  input: AttachmentImportCleanupInput,
): Promise<void> => {
  let reported = false;
  const report = (): void => {
    if (reported) return;
    reported = true;
    logError("attachment.import_cleanup_failed", { outcome: "error" });
  };
  if (input.body) {
    try {
      void input.body.cancel(input.reason).catch(report);
    } catch {
      report();
    }
  }
  if (!input.remove) return;

  const removal = Promise.allSettled([
    Promise.resolve().then(input.remove),
  ]).then((results) => {
    if (results.some((result) => result.status === "rejected")) report();
  });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CLEANUP_WAIT_MS);
    timer.unref();
  });
  const result = await Promise.race([
    removal.then(() => "removed" as const),
    deadline,
  ]);
  if (timer) clearTimeout(timer);
  if (result === "timeout") report();
};
