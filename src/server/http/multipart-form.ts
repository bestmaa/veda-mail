import "server-only";

import { ApiError } from "@/transport/http/api-error";

export const MAX_MULTIPART_FORM_BYTES = 3 * 1024 * 1024;

const tooLarge = (): ApiError =>
  new ApiError(
    "The uploaded form is too large.",
    "REQUEST_BODY_TOO_LARGE",
    413,
  );

const assertDeclaredSize = (request: Request, maximumBytes: number): void => {
  const declared = request.headers.get("content-length")?.trim();
  if (!declared || !/^\d+$/.test(declared)) {
    return;
  }
  if (BigInt(declared) > BigInt(maximumBytes)) {
    throw tooLarge();
  }
};

const assertMultipart = (request: Request): string => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new ApiError(
      "Send this request as multipart form data.",
      "UNSUPPORTED_MEDIA_TYPE",
      415,
    );
  }
  return contentType;
};

const readBody = async (
  request: Request,
  maximumBytes: number,
): Promise<ArrayBuffer> => {
  if (!request.body) {
    throw new ApiError("Form data is required.", "INVALID_FORM", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (total + result.value.byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const body = new ArrayBuffer(total);
  const bytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const readMultipartFormData = async (
  request: Request,
  maximumBytes = MAX_MULTIPART_FORM_BYTES,
): Promise<FormData> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new RangeError("maximumBytes must be a positive safe integer.");
  }
  assertDeclaredSize(request, maximumBytes);
  const contentType = assertMultipart(request);
  const body = await readBody(request, maximumBytes);
  return new Request(request.url, {
    body,
    headers: { "content-type": contentType },
    method: "POST",
  }).formData();
};
