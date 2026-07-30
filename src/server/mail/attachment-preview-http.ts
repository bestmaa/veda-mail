import "server-only";

import { z } from "zod";

import type { PreparedAttachmentPreview } from "@/server/mail/attachment-preview";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure } from "@/transport/http/api-response";

const RESPONSE_CHUNK_BYTES = 64 * 1_024;
export const ATTACHMENT_PREVIEW_RESPONSE_TIMEOUT_MS = 30 * 1_000;

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

export const parseAttachmentPreviewRouteParams = (input: unknown) =>
  routeParamsSchema.parse(input);

const previewRequestSchema = z
  .object({ renderer: z.literal("text") })
  .strict();

export const parseAttachmentPreviewRequest = (input: unknown) =>
  previewRequestSchema.parse(input);

export const attachmentPreviewHeaders = (): Headers =>
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

export const createAttachmentPreviewResponse = (
  preview: PreparedAttachmentPreview,
  signal?: AbortSignal,
  timeoutMs = ATTACHMENT_PREVIEW_RESPONSE_TIMEOUT_MS,
): Response => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    preview.dispose();
    throw new RangeError("Attachment preview response timeout is invalid.");
  }
  if (signal?.aborted) {
    preview.dispose();
    throw new ApiError(
      "The attachment preview was cancelled.",
      "ATTACHMENT_PREVIEW_ABORTED",
      499,
    );
  }
  const headers = attachmentPreviewHeaders();
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Content-Length", String(preview.bytes.byteLength));
  headers.set(
    "Content-Disposition",
    'inline; filename="attachment-preview.txt"',
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
    preview.dispose();
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
        "The attachment preview was cancelled.",
        "ATTACHMENT_PREVIEW_ABORTED",
        499,
      ),
    );
  try {
    const body = new ReadableStream<Uint8Array>(
      {
        cancel: () => dispose(),
        pull: (streamController) => {
          if (disposed) return;
          if (offset >= preview.bytes.byteLength) {
            streamController.close();
            dispose();
            return;
          }
          const end = Math.min(
            preview.bytes.byteLength,
            offset + RESPONSE_CHUNK_BYTES,
          );
          streamController.enqueue(preview.bytes.slice(offset, end));
          offset = end;
          if (offset >= preview.bytes.byteLength) {
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
                "The attachment preview response took too long.",
                "ATTACHMENT_PREVIEW_RESPONSE_TIMEOUT",
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

export const attachmentPreviewFailure = (
  error: unknown,
  fallback = "Unable to preview this attachment.",
): Response => {
  const response = apiFailure(error, fallback);
  const headers = attachmentPreviewHeaders();
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
};

export const attachmentPreviewMethodNotAllowed = (): Response => {
  const response = attachmentPreviewFailure(
    new ApiError(
      "Attachment previews require an explicit request.",
      "ATTACHMENT_PREVIEW_METHOD_NOT_ALLOWED",
      405,
    ),
  );
  response.headers.set("Allow", "POST");
  return response;
};
