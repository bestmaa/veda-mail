import "server-only";

import { z } from "zod";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import {
  attachmentContentDisposition,
  attachmentDownloadFailure,
  attachmentDownloadHeaders,
} from "@/server/mail/attachment-download-http";
import { ApiError } from "@/transport/http/api-error";

const routeParamsSchema = z
  .object({
    messageId: z
      .string()
      .min(1)
      .max(2_048)
      .regex(/^[A-Za-z0-9_-]+$/u, "Message identifier is invalid."),
  })
  .strict();

export const parseAttachmentArchiveRouteParams = (input: unknown) =>
  routeParamsSchema.parse(input);

export const assertAttachmentArchiveRequest = (request: Request): void => {
  if (request.headers.has("range")) {
    throw new ApiError(
      "Attachment archive byte ranges are not supported.",
      "ATTACHMENT_ARCHIVE_RANGE_NOT_SATISFIABLE",
      416,
    );
  }
  if (new URL(request.url).search !== "") {
    throw new ApiError(
      "Attachment archive query parameters are not supported.",
      "INVALID_ATTACHMENT_ARCHIVE",
      400,
    );
  }
};

export const createAttachmentArchiveResponse = (
  body: ReadableStream<Uint8Array>,
): Response => {
  const headers = attachmentDownloadHeaders();
  headers.set("Content-Type", "application/zip");
  headers.set(
    "Content-Disposition",
    attachmentContentDisposition("attachments.zip"),
  );
  return new Response(body, { headers, status: 200 });
};

const mapArchiveError = (error: AttachmentDownloadError): ApiError => {
  switch (error.code) {
    case "aborted":
      return new ApiError(
        "The attachment archive was cancelled.",
        "ATTACHMENT_ARCHIVE_ABORTED",
        499,
      );
    case "invalid_request":
      return new ApiError(
        "The attachment archive request is invalid.",
        "INVALID_ATTACHMENT_ARCHIVE",
        400,
      );
    case "not_found":
      return new ApiError(
        "The message or an attachment was not found.",
        "ATTACHMENT_ARCHIVE_NOT_FOUND",
        404,
      );
    case "provider_failure":
      return new ApiError(
        "The attachment archive could not be retrieved from the provider.",
        "ATTACHMENT_ARCHIVE_PROVIDER_FAILED",
        502,
      );
    case "size_limit_exceeded":
      return new ApiError(
        "The attachments are too large to archive together.",
        "ATTACHMENT_ARCHIVE_TOO_LARGE",
        413,
      );
    case "timeout":
      return new ApiError(
        "The attachment archive took too long to generate.",
        "ATTACHMENT_ARCHIVE_TIMEOUT",
        504,
      );
  }
};

export const attachmentArchiveFailure = (error: unknown): Response => {
  const response = attachmentDownloadFailure(
    error instanceof AttachmentDownloadError ? mapArchiveError(error) : error,
  );
  response.headers.set(
    "Content-Disposition",
    attachmentContentDisposition("attachment-archive-error.json"),
  );
  return response;
};
