import "server-only";

import { MAX_MESSAGE_SOURCE_IMPORT_BYTES } from "@/domain/mail/message-source";
import { MessageSourceImportError } from "@/domain/mail/message-source-import-error";
import { id } from "@/domain/shared/brand";
import { ApiError } from "@/transport/http/api-error";

const fail = (message: string, code: string, status: number): never => {
  throw new ApiError(message, code, status);
};

export const parseMessageSourceImportMailbox = (request: Request) => {
  const value = new URL(request.url).searchParams.get("mailboxId")?.trim() ?? "";
  if (!value || value.length > 2_048) {
    return fail("Choose a destination mailbox.", "MESSAGE_IMPORT_MAILBOX_INVALID", 400);
  }
  return id.mailbox(value);
};

export const readMessageSourceImportBody = async (
  request: Request,
): Promise<Uint8Array> => {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]
    ?.trim().toLowerCase();
  if (mediaType !== "message/rfc822") {
    return fail(
      "Upload an RFC 5322 .eml file.",
      "MESSAGE_IMPORT_MEDIA_TYPE_INVALID",
      415,
    );
  }
  const lengthText = request.headers.get("content-length");
  const length = lengthText && /^\d{1,9}$/u.test(lengthText)
    ? Number(lengthText)
    : Number.NaN;
  if (!Number.isSafeInteger(length) || length < 1) {
    return fail(
      "Message import requires a non-empty Content-Length.",
      "MESSAGE_IMPORT_LENGTH_REQUIRED",
      411,
    );
  }
  if (length > MAX_MESSAGE_SOURCE_IMPORT_BYTES) {
    return fail("Message source is too large.", "MESSAGE_IMPORT_TOO_LARGE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return fail("Message source is empty.", "MESSAGE_IMPORT_EMPTY", 400);
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > length || received > MAX_MESSAGE_SOURCE_IMPORT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return fail("Message source length is invalid.", "MESSAGE_IMPORT_LENGTH_MISMATCH", 400);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== length) {
    return fail("Message source length is invalid.", "MESSAGE_IMPORT_LENGTH_MISMATCH", 400);
  }
  const source = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { source.set(chunk, offset); offset += chunk.byteLength; }
  return source;
};

export const asMessageSourceImportApiError = (error: unknown): unknown => {
  if (!(error instanceof MessageSourceImportError)) return error;
  if (error.code === "aborted") return new ApiError(
    "Message import was cancelled.", "MESSAGE_IMPORT_ABORTED", 499,
  );
  if (error.code === "size_limit_exceeded") return new ApiError(
    "Message source is too large.", "MESSAGE_IMPORT_TOO_LARGE", 413,
  );
  if (error.code === "mailbox_not_found") return new ApiError(
    "Destination mailbox was not found.", "MESSAGE_IMPORT_MAILBOX_NOT_FOUND", 404,
  );
  if (error.code === "mailbox_forbidden") return new ApiError(
    "Destination mailbox does not accept messages.", "MESSAGE_IMPORT_MAILBOX_FORBIDDEN", 403,
  );
  if (error.code === "provider_rejected") return new ApiError(
    "Mail provider rejected this RFC 5322 message.", "MESSAGE_IMPORT_REJECTED", 422,
  );
  return new ApiError(
    "Mail provider could not import this message.", "MESSAGE_IMPORT_PROVIDER_FAILED", 502,
  );
};
