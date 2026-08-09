import "server-only";

import { z } from "zod";

import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES, type MessageSourceDownload } from "@/domain/mail/message-source";
import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";
import {
  createLeasedAttachmentDownloadStream,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure } from "@/transport/http/api-response";

const paramsSchema = z.object({
  messageId: z.string().min(1).max(2_048).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();

export const parseMessageSourceParams = (input: unknown) => {
  const parsed = paramsSchema.safeParse(input);
  if (!parsed.success) {
    throw new MessageSourceDownloadError(
      "invalid_request",
      "Message export route parameters are invalid.",
    );
  }
  return parsed.data;
};

export const messageSourceHeaders = (): Headers => new Headers({
  "Accept-Ranges": "none",
  "Cache-Control": "private, no-store, no-transform, max-age=0",
  "Content-Disposition": 'attachment; filename="message.eml"',
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Content-Type": "message/rfc822",
  "Cross-Origin-Resource-Policy": "same-origin",
  Expires: "0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Download-Options": "noopen",
});

export const createMessageSourceResponse = (
  download: MessageSourceDownload,
  lease: AttachmentDownloadLease,
  signal?: AbortSignal,
): Response => {
  if (
    !Number.isSafeInteger(download.size) ||
    download.size < 0 ||
    download.size > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES
  ) {
    lease.release();
    void download.body.cancel().catch(() => undefined);
    throw new MessageSourceDownloadError(
      "size_limit_exceeded",
      "Message source exceeds the download size limit.",
    );
  }
  const headers = messageSourceHeaders();
  headers.set("Content-Length", String(download.size));
  return new Response(createLeasedAttachmentDownloadStream({
    expectedBytes: download.size,
    lease,
    maxBytes: MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
    ...(signal ? { signal } : {}),
    source: download.body,
  }), { headers });
};

export const asMessageSourceApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error instanceof MessageSourceDownloadError) {
    if (error.code === "not_found") {
      return new ApiError("The message was not found.", "MESSAGE_NOT_FOUND", 404);
    }
    if (error.code === "size_limit_exceeded") {
      return new ApiError("This message is too large to export.", "MESSAGE_SOURCE_TOO_LARGE", 413);
    }
    if (error.code === "invalid_request") {
      return new ApiError("The message export request is invalid.", "INVALID_MESSAGE_EXPORT", 400);
    }
    if (error.code === "aborted") {
      return new ApiError("The message export was cancelled.", "MESSAGE_SOURCE_ABORTED", 499);
    }
  }
  return new ApiError(
    "The original message could not be retrieved from the mail provider.",
    "MESSAGE_SOURCE_PROVIDER_FAILED",
    502,
  );
};

export const messageSourceFailure = (error: unknown): Response => {
  const response = apiFailure(asMessageSourceApiError(error), "Unable to export this message.");
  for (const [name, value] of messageSourceHeaders()) response.headers.set(name, value);
  response.headers.delete("Content-Disposition");
  response.headers.set("Content-Type", "application/json; charset=utf-8");
  return response;
};
