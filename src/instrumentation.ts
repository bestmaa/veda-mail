import {
  logError,
  safeErrorType,
} from "@/server/observability/structured-log";
import { normalizeRequestId } from "@/transport/http/request-id";

export const register = async (): Promise<void> => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { installProviderSnoozeOperationAdapter } = await import(
    "./server/snooze/provider-snooze-operation.adapter"
  );
  installProviderSnoozeOperationAdapter();
  const { startScheduledSendWorker } = await import(
    "./server/scheduled-send/scheduled-send-worker"
  );
  await startScheduledSendWorker();
  const { startSnoozeWorker } = await import(
    "./server/snooze/snooze-worker"
  );
  await startSnoozeWorker().catch(() => {
    logError("worker.snooze_start_failed", { outcome: "error" });
  });
};

export const onRequestError = (
  error: unknown,
  request: Readonly<{
    readonly headers: NodeJS.Dict<string | string[]>;
    readonly method: string;
    readonly path: string;
  }>,
): void => {
  const header = request.headers["x-request-id"];
  const requestId = normalizeRequestId(
    Array.isArray(header) ? (header[0] ?? null) : (header ?? null),
  );
  logError("http.unhandled_request_error", {
    errorType: safeErrorType(error),
    method: request.method,
    outcome: "error",
    ...(requestId ? { requestId } : {}),
    route: request.path,
    statusCode: 500,
  });
};
