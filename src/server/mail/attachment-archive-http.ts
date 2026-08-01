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

const EMPTY_BODY_READ_TIMEOUT_MS = 1_000;
const MAX_EMPTY_BODY_CHUNKS = 8;

const invalidArchiveBody = (): ApiError =>
  new ApiError(
    "Attachment archive request bodies are not supported.",
    "INVALID_ATTACHMENT_ARCHIVE",
    400,
  );

const readBodyChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array> | null> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), EMPTY_BODY_READ_TIMEOUT_MS);
    timer.unref();
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const assertEmptyArchiveBody = async (request: Request): Promise<void> => {
  if (request.body === null) return;
  const reader = request.body.getReader();
  try {
    for (let index = 0; index < MAX_EMPTY_BODY_CHUNKS; index += 1) {
      const result = await readBodyChunk(reader).catch(() => null);
      if (!result) throw invalidArchiveBody();
      if (result.done) return;
      if (result.value.byteLength > 0) throw invalidArchiveBody();
    }
    throw invalidArchiveBody();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
};

export const assertAttachmentArchiveRequest = async (
  request: Request,
  allowedQueryParameter?: string,
): Promise<void> => {
  const contentLength = request.headers.get("content-length");
  if (
    request.headers.has("transfer-encoding") ||
    (contentLength !== null && contentLength !== "0")
  ) {
    throw invalidArchiveBody();
  }
  if (request.headers.has("range")) {
    throw new ApiError(
      "Attachment archive byte ranges are not supported.",
      "ATTACHMENT_ARCHIVE_RANGE_NOT_SATISFIABLE",
      416,
    );
  }
  const searchParams = new URL(request.url).searchParams;
  const allowedQuery =
    allowedQueryParameter &&
    searchParams.size === 1 &&
    searchParams.getAll(allowedQueryParameter).length === 1;
  if (searchParams.size > 0 && !allowedQuery) {
    throw new ApiError(
      "Attachment archive query parameters are not supported.",
      "INVALID_ATTACHMENT_ARCHIVE",
      400,
    );
  }
  await assertEmptyArchiveBody(request);
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
