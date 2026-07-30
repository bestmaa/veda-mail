import "server-only";

import { z } from "zod";

import type { PreparedInlineImage } from "@/server/mail/inline-image";
import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_OUTPUT_MIME_TYPE,
} from "@/server/mail/inline-image-raster";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure } from "@/transport/http/api-response";

const RESPONSE_CHUNK_BYTES = 64 * 1_024;
export const INLINE_IMAGE_RESPONSE_TIMEOUT_MS = 30 * 1_000;

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

export const parseInlineImageRouteParams = (input: unknown) =>
  routeParamsSchema.parse(input);

const requestSchema = z
  .object({ renderer: z.literal("inline-image") })
  .strict();

export const parseInlineImageRequest = (input: unknown) =>
  requestSchema.parse(input);

export const inlineImageHeaders = (): Headers =>
  new Headers({
    "Accept-Ranges": "none",
    "Cache-Control": "private, no-store, no-transform, max-age=0",
    "Content-Security-Policy":
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    Expires: "0",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Download-Options": "noopen",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });

const invalidPreparedImage = (): ApiError =>
  new ApiError(
    "The inline image could not be prepared.",
    "INLINE_IMAGE_PROCESSOR_UNAVAILABLE",
    503,
  );

export const createInlineImageResponse = (
  image: PreparedInlineImage,
  signal?: AbortSignal,
  timeoutMs = INLINE_IMAGE_RESPONSE_TIMEOUT_MS,
): Response => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    image.dispose();
    throw new RangeError("Inline image response timeout is invalid.");
  }
  if (
    image.mimeType !== INLINE_IMAGE_OUTPUT_MIME_TYPE ||
    image.bytes.byteLength < 1 ||
    image.bytes.byteLength > INLINE_IMAGE_MAX_BYTES
  ) {
    image.dispose();
    throw invalidPreparedImage();
  }
  if (signal?.aborted) {
    image.dispose();
    throw new ApiError(
      "The inline image request was cancelled.",
      "INLINE_IMAGE_ABORTED",
      499,
    );
  }
  const headers = inlineImageHeaders();
  headers.set("Content-Type", INLINE_IMAGE_OUTPUT_MIME_TYPE);
  headers.set("Content-Length", String(image.bytes.byteLength));
  headers.set(
    "Content-Disposition",
    'inline; filename="inline-image.webp"',
  );
  let offset = 0;
  let disposed = false;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    image.dispose();
  };
  const fail = (error: ApiError): void => {
    if (disposed) return;
    try {
      controller?.error(error);
    } catch {
      // The response may already be closed while its final pull is settling.
    }
    dispose();
  };
  const onAbort = (): void =>
    fail(
      new ApiError(
        "The inline image request was cancelled.",
        "INLINE_IMAGE_ABORTED",
        499,
      ),
    );
  try {
    const body = new ReadableStream<Uint8Array>(
      {
        cancel: () => dispose(),
        pull: (streamController) => {
          if (disposed) return;
          if (offset >= image.bytes.byteLength) {
            streamController.close();
            dispose();
            return;
          }
          const end = Math.min(
            image.bytes.byteLength,
            offset + RESPONSE_CHUNK_BYTES,
          );
          streamController.enqueue(
            Uint8Array.from(image.bytes.subarray(offset, end)),
          );
          offset = end;
          if (offset >= image.bytes.byteLength) {
            streamController.close();
            dispose();
          }
        },
        start: (streamController) => {
          controller = streamController;
          signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => {
            fail(
              new ApiError(
                "The inline image response took too long.",
                "INLINE_IMAGE_RESPONSE_TIMEOUT",
                504,
              ),
            );
          }, timeoutMs);
          timer.unref();
          if (signal?.aborted) onAbort();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { headers, status: 200 });
  } catch (error) {
    dispose();
    throw error;
  }
};

export const inlineImageFailure = (
  error: unknown,
  fallback = "Unable to render this inline image.",
): Response => {
  const response = apiFailure(error, fallback);
  const headers = inlineImageHeaders();
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
};

export const inlineImageMethodNotAllowed = (): Response => {
  const response = inlineImageFailure(
    new ApiError(
      "Inline images require an explicit request.",
      "INLINE_IMAGE_METHOD_NOT_ALLOWED",
      405,
    ),
  );
  response.headers.set("Allow", "POST");
  return response;
};
