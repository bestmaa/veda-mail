import "server-only";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_JMAP_JSON_RESPONSE_BYTES = 16 * 1_024 * 1_024;

export const invalidJmapResponse = (subject: string): Error =>
  new Error(`Mail provider returned invalid ${subject}.`);

export const readJmapResponseJson = async (
  response: Response,
  maximumBytes = MAX_JMAP_JSON_RESPONSE_BYTES,
): Promise<unknown> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }
  const declared = response.headers.get("content-length")?.trim();
  if (
    declared &&
    /^\d+$/u.test(declared) &&
    BigInt(declared) > BigInt(maximumBytes)
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw invalidJmapResponse("JSON size");
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidJmapResponse("JSON");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        throw invalidJmapResponse("JSON size");
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidJmapResponse("JSON");
  } finally {
    reader.releaseLock();
  }
};

export const sameOriginJmapUrl = (
  value: string,
  expectedOrigin: string,
): URL => {
  const parsed = new URL(value, expectedOrigin);
  if (
    parsed.origin !== expectedOrigin ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("Mail provider returned a cross-origin JMAP endpoint.");
  }
  return parsed;
};

export const fetchSameOriginJmap = async (
  initialUrl: URL,
  expectedOrigin: string,
  init: RequestInit,
): Promise<Response> => {
  let requestUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(requestUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirectCount === 3) {
      throw new Error("Mail provider returned an invalid redirect.");
    }
    requestUrl = sameOriginJmapUrl(location, expectedOrigin);
  }
  throw new Error("Mail provider returned too many redirects.");
};
