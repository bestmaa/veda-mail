import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import { ApiClientError } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const INLINE_IMAGE_CLIENT_MAX_BYTES = 5 * 1024 * 1024;
export const INLINE_IMAGE_MAX_ATTEMPTS = 3;
export const INLINE_IMAGE_MAX_RETRY_DELAY_MS = 2_000;
const INLINE_IMAGE_MIME_TYPE = "image/webp";
const INLINE_IMAGE_RETRY_BASE_DELAY_MS = 250;
const INLINE_IMAGE_BUSY_CODE = "INLINE_IMAGE_BUSY";
const INLINE_IMAGE_ROUTE =
  /^\/api\/v1\/mail\/messages\/[^/?#]+\/attachments\/[^/?#]+\/inline-image$/u;
const SAFE_API_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

export const createInlineImageHref = (
  messageId: MessageId | string,
  attachmentId: AttachmentId | string,
): string =>
  `/api/v1/mail/messages/${encodeURIComponent(
    messageId,
  )}/attachments/${encodeURIComponent(attachmentId)}/inline-image`;

const assertInlineImageHref = (href: string): void => {
  if (!INLINE_IMAGE_ROUTE.test(href)) {
    throw new Error("The inline image reference is invalid.");
  }
};

interface InlineImageFailureDetails {
  readonly code: string | null;
  readonly message: string;
}

const failureDetails = async (
  response: Response,
): Promise<InlineImageFailureDetails> => {
  const payload = (await response.json().catch(() => ({}))) as {
    readonly error?: {
      readonly code?: unknown;
      readonly message?: unknown;
    };
  };
  const code = payload.error?.code;
  const message = payload.error?.message;
  return {
    code:
      typeof code === "string" && SAFE_API_ERROR_CODE.test(code)
        ? code
        : null,
    message:
      typeof message === "string" && message.length > 0
        ? message
        : `Inline image request failed with status ${response.status}.`,
  };
};

class InlineImageHttpError extends ApiClientError {
  public constructor(
    message: string,
    code: string | null,
    public readonly retryAfterMs: number | null,
    status: number,
  ) {
    super(message, status, code ?? "UNKNOWN_ERROR");
    this.name = "InlineImageHttpError";
  }
}

const retryAfterMilliseconds = (response: Response): number | null => {
  const value = response.headers.get("retry-after")?.trim();
  if (!value || value.length > 128) return null;
  if (/^\d{1,10}$/u.test(value)) {
    const milliseconds = Number(value) * 1_000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
};

const abortReason = (signal?: AbortSignal): Error =>
  signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The inline image request was cancelled.", "AbortError");

const waitForRetry = (
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });

const retryDelay = (
  error: InlineImageHttpError,
  failedAttempt: number,
): number | null => {
  if (
    error.status !== 503 &&
    !(error.status === 429 && error.code === INLINE_IMAGE_BUSY_CODE)
  ) {
    return null;
  }
  if (
    error.retryAfterMs !== null &&
    error.retryAfterMs > INLINE_IMAGE_MAX_RETRY_DELAY_MS
  ) {
    return null;
  }
  const fallback = Math.min(
    INLINE_IMAGE_RETRY_BASE_DELAY_MS * 2 ** failedAttempt,
    INLINE_IMAGE_MAX_RETRY_DELAY_MS,
  );
  return Math.max(fallback, error.retryAfterMs ?? 0);
};

const cancelResponse = async (
  response: Response,
  error: Error,
): Promise<never> => {
  await response.body?.cancel(error).catch(() => undefined);
  throw error;
};

const readBoundedInlineImage = async (
  response: Response,
  declaredLength: number,
): Promise<Blob> => {
  if (!response.body) {
    throw new Error("The inline image returned no content.");
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(declaredLength);
  let offset = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (
        !(result.value instanceof Uint8Array) ||
        result.value.byteLength > declaredLength - offset
      ) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The inline image exceeded its safe size.");
      }
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== declaredLength) {
    bytes.fill(0);
    throw new Error("The inline image response was incomplete.");
  }
  const blob = new Blob([bytes], { type: INLINE_IMAGE_MIME_TYPE });
  bytes.fill(0);
  return blob;
};

const fetchInlineImageOnce = async (
  href: string,
  sessionScope: string,
  signal?: AbortSignal,
): Promise<Blob> => {
  const response = await fetch(href, {
    body: JSON.stringify({ renderer: "inline-image" }),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: INLINE_IMAGE_MIME_TYPE,
      "Content-Type": "application/json",
      ...mailSessionScopeHeaders(sessionScope),
    },
    method: "POST",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const failure = await failureDetails(response);
    throw new InlineImageHttpError(
      failure.message,
      failure.code,
      retryAfterMilliseconds(response),
      response.status,
    );
  }
  if (
    response.headers.get("content-type")?.toLowerCase() !==
    INLINE_IMAGE_MIME_TYPE
  ) {
    return cancelResponse(
      response,
      new Error("The inline image returned an unsafe type."),
    );
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > INLINE_IMAGE_CLIENT_MAX_BYTES
  ) {
    return cancelResponse(
      response,
      new Error("The inline image returned an invalid size."),
    );
  }
  return readBoundedInlineImage(response, declaredLength);
};

export const fetchInlineImage = async (
  href: string,
  sessionScope: string,
  signal?: AbortSignal,
): Promise<Blob> => {
  assertInlineImageHref(href);
  for (let attempt = 0; attempt < INLINE_IMAGE_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw abortReason(signal);
    try {
      return await fetchInlineImageOnce(href, sessionScope, signal);
    } catch (error) {
      if (
        !(error instanceof InlineImageHttpError) ||
        attempt === INLINE_IMAGE_MAX_ATTEMPTS - 1
      ) {
        throw error;
      }
      const delayMs = retryDelay(error, attempt);
      if (delayMs === null) throw error;
      await waitForRetry(delayMs, signal);
    }
  }
  throw new Error("The inline image retry budget was exhausted.");
};
