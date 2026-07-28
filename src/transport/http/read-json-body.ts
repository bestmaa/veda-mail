import "server-only";

import { ApiError } from "@/transport/http/api-error";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

const unsupportedMediaType = (): ApiError =>
  new ApiError(
    "Send this request as application/json.",
    "UNSUPPORTED_MEDIA_TYPE",
    415,
  );

const invalidContentLength = (): ApiError =>
  new ApiError(
    "Content-Length must be a non-negative integer.",
    "INVALID_CONTENT_LENGTH",
    400,
  );

const tooLarge = (): ApiError =>
  new ApiError(
    "The JSON request body is too large.",
    "REQUEST_BODY_TOO_LARGE",
    413,
  );

const invalidJson = (): ApiError =>
  new ApiError(
    "The request body must contain valid JSON.",
    "INVALID_JSON",
    400,
  );

const assertJsonContentType = (request: Request): void => {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw unsupportedMediaType();
  }
};

const assertDeclaredSize = (
  request: Request,
  maximumBytes: number,
): void => {
  const header = request.headers.get("content-length");
  if (header === null) return;

  const declared = header.trim();
  if (!/^\d+$/.test(declared)) {
    throw invalidContentLength();
  }
  if (BigInt(declared) > BigInt(maximumBytes)) {
    throw tooLarge();
  }
};

const readBytes = async (
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> => {
  if (!request.body) {
    throw invalidJson();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      if (result.value.byteLength > maximumBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const parseJson = (bytes: Uint8Array): unknown => {
  if (bytes.byteLength === 0) {
    throw invalidJson();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.trim().length === 0) {
      throw invalidJson();
    }
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidJson();
  }
};

export const readJsonBody = async (
  request: Request,
  maximumBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }

  assertJsonContentType(request);
  assertDeclaredSize(request, maximumBytes);
  return parseJson(await readBytes(request, maximumBytes));
};
