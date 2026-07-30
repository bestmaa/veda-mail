import "server-only";

import { z } from "zod";

import type { AttachmentDownload } from "@/domain/mail/mail";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import {
  MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import {
  createLeasedAttachmentDownloadStream,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure } from "@/transport/http/api-response";

export const ATTACHMENT_DOWNLOAD_MAX_BYTES =
  MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES;

const routeParamsSchema = z
  .object({
    attachmentId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/u, "Attachment identifier is invalid."),
    messageId: z
      .string()
      .min(1)
      .max(2_048)
      .regex(/^[A-Za-z0-9_-]+$/u, "Message identifier is invalid."),
  })
  .strict();

export const parseAttachmentDownloadRouteParams = (input: unknown) =>
  routeParamsSchema.parse(input);

export const attachmentDownloadHeaders = (): Headers =>
  new Headers({
    "Accept-Ranges": "none",
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    Expires: "0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Download-Options": "noopen",
  });

const asciiFallback = (value: string): string =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint <= 0x7e ? character : "_";
    })
    .join("");

const quoted = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const extended = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const attachmentContentDisposition = (input: unknown): string => {
  const name = sanitizeReceivedAttachmentName(input);
  return `attachment; filename=${quoted(
    asciiFallback(name),
  )}; filename*=UTF-8''${extended(name)}`;
};

const assertDownloadSize = (size: number | null): number | null => {
  if (size === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new AttachmentDownloadError(
      "provider_failure",
      "The mail provider returned an invalid attachment size.",
    );
  }
  if (size > ATTACHMENT_DOWNLOAD_MAX_BYTES) {
    throw new AttachmentDownloadError(
      "size_limit_exceeded",
      "The attachment exceeds the download size limit.",
    );
  }
  return size;
};

export const createAttachmentDownloadResponse = (
  download: AttachmentDownload,
  lease: AttachmentDownloadLease,
  signal?: AbortSignal,
): Response => {
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    if (signal?.aborted) {
      throw new AttachmentDownloadError(
        "aborted",
        "The attachment download was cancelled.",
      );
    }
    const size = assertDownloadSize(download.size);
    const headers = attachmentDownloadHeaders();
    headers.set("Content-Type", "application/octet-stream");
    headers.set(
      "Content-Disposition",
      attachmentContentDisposition(download.name),
    );
    if (size !== null) headers.set("Content-Length", String(size));
    body = createLeasedAttachmentDownloadStream({
      ...(size === null ? {} : { expectedBytes: size }),
      ...(signal ? { signal } : {}),
      lease,
      maxBytes: ATTACHMENT_DOWNLOAD_MAX_BYTES,
      source: download.body,
    });
    return new Response(body, { headers, status: 200 });
  } catch (error) {
    void (body ?? download.body).cancel(error).catch(() => undefined);
    lease.release();
    throw error;
  }
};

const mappedAttachmentError = (error: AttachmentDownloadError): ApiError => {
  switch (error.code) {
    case "aborted":
      return new ApiError(
        "The attachment download was cancelled.",
        "ATTACHMENT_DOWNLOAD_ABORTED",
        499,
      );
    case "invalid_request":
      return new ApiError(
        "The attachment download request is invalid.",
        "INVALID_ATTACHMENT_DOWNLOAD",
        400,
      );
    case "not_found":
      return new ApiError(
        "The attachment was not found.",
        "ATTACHMENT_NOT_FOUND",
        404,
      );
    case "provider_failure":
      return new ApiError(
        "The attachment could not be retrieved from the mail provider.",
        "ATTACHMENT_PROVIDER_FAILED",
        502,
      );
    case "size_limit_exceeded":
      return new ApiError(
        "This attachment is too large to download.",
        "ATTACHMENT_TOO_LARGE",
        413,
      );
    case "timeout":
      return new ApiError(
        "The mail provider took too long to return this attachment.",
        "ATTACHMENT_PROVIDER_TIMEOUT",
        504,
      );
  }
};

export const asAttachmentDownloadApiError = (error: unknown): ApiError =>
  error instanceof AttachmentDownloadError
    ? mappedAttachmentError(error)
    : error instanceof ApiError
      ? error
      : new ApiError(
          "The attachment could not be retrieved from the mail provider.",
          "ATTACHMENT_PROVIDER_FAILED",
          502,
        );

export const attachmentDownloadFailure = (error: unknown): Response => {
  const response = apiFailure(error, "Unable to download this attachment.");
  const headers = attachmentDownloadHeaders();
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
};
