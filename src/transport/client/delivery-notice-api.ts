import { ApiClientError } from "@/transport/client/api-client";

const DELIVERY_NOTICE_ROUTE = "/api/v1/mail/delivery-notices";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DELIVERY_NOTICE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const declared = response.headers.get("content-length");
  if (
    declared &&
    (!/^\d{1,10}$/u.test(declared) ||
      Number(declared) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The delivery notice response was too large.");
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The delivery notice response was too large.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};

const object = (
  value: unknown,
): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

const failure = async (response: Response): Promise<ApiClientError> => {
  let payload: Readonly<Record<string, unknown>> | null = null;
  try {
    payload = object(await readBoundedJson(response));
  } catch {
    // Fall through to a bounded generic error.
  }
  const error = object(payload?.["error"]);
  const rawCode = error?.["code"];
  const rawMessage = error?.["message"];
  const code =
    typeof rawCode === "string" && SAFE_ERROR_CODE.test(rawCode)
      ? rawCode
      : "UNKNOWN_ERROR";
  const message =
    typeof rawMessage === "string" &&
    rawMessage.length > 0 &&
    rawMessage.length <= 500 &&
    !hasControlCharacter(rawMessage)
      ? rawMessage
      : `Delivery notice request failed with status ${response.status}.`;
  return new ApiClientError(message, response.status, code);
};

const requestOptions = (signal?: AbortSignal): RequestInit => ({
  cache: "no-store",
  credentials: "same-origin",
  headers: { Accept: "application/json" },
  redirect: "error",
  referrerPolicy: "no-referrer",
  ...(signal ? { signal } : {}),
});

export const deliveryNoticeApi = {
  async dismiss(noticeId: string, signal?: AbortSignal): Promise<void> {
    if (!DELIVERY_NOTICE_ID.test(noticeId)) {
      throw new Error("The delivery notice reference is invalid.");
    }
    const response = await fetch(
      `${DELIVERY_NOTICE_ROUTE}/${encodeURIComponent(noticeId)}`,
      { ...requestOptions(signal), method: "DELETE" },
    );
    if (!response.ok) throw await failure(response);
  },

  async list(signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(DELIVERY_NOTICE_ROUTE, requestOptions(signal));
    if (!response.ok) throw await failure(response);
    const envelope = object(await readBoundedJson(response));
    return object(envelope?.["data"])?.["notices"];
  },
};
