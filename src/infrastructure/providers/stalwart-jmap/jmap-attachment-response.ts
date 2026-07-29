import "server-only";

import { createBoundedAttachmentDownloadStream } from "@/infrastructure/providers/attachment-download-stream";
import { readJmapStreamWithAbort } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-stream";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";

const cancelResponseBody = (response: Response): void => {
  void response.body?.cancel().catch(() => undefined);
};

const aborted = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "aborted",
    "The attachment operation was cancelled.",
  );

const declaredLength = (
  response: Response,
  required: boolean,
): number | undefined => {
  const header = response.headers.get("content-length");
  if (header === null) {
    if (!required) return undefined;
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length was missing.",
    );
  }
  if (!/^(0|[1-9]\d*)$/u.test(header)) {
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length was invalid.",
    );
  }
  const length = Number(header);
  if (!Number.isSafeInteger(length)) {
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length was invalid.",
    );
  }
  return length;
};

const assertIdentityEncoding = (response: Response): void => {
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "invalid_provider_response",
      "Mail provider returned an unsupported attachment encoding.",
    );
  }
};

const validateResponseLength = (
  response: Response,
  options: {
    readonly expectedBytes?: number;
    readonly maxBytes: number;
    readonly requireContentLength: boolean;
    readonly requireIdentityEncoding?: boolean;
  },
): number | undefined => {
  if (options.requireIdentityEncoding) assertIdentityEncoding(response);
  const declared = declaredLength(response, options.requireContentLength);
  if (
    (declared !== undefined && declared > options.maxBytes) ||
    (options.expectedBytes !== undefined &&
      options.expectedBytes > options.maxBytes)
  ) {
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "size_limit_exceeded",
      "The attachment exceeds the configured size limit.",
    );
  }
  if (
    declared !== undefined &&
    options.expectedBytes !== undefined &&
    declared !== options.expectedBytes
  ) {
    cancelResponseBody(response);
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length did not match metadata.",
    );
  }
  return declared;
};

const jmapStreamErrors = (signal?: AbortSignal) => ({
  aborted: () =>
    signal?.reason instanceof JmapAttachmentTransportError
      ? signal.reason
      : new JmapAttachmentTransportError(
          "aborted",
          "The attachment operation was cancelled.",
        ),
  providerFailure: () =>
    new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length did not match metadata.",
    ),
  sizeLimit: () =>
    new JmapAttachmentTransportError(
      "size_limit_exceeded",
      "The attachment exceeds the configured size limit.",
    ),
  timeout: () =>
    new JmapAttachmentTransportError(
      "timeout",
      "The mail provider attachment operation timed out.",
    ),
});

export const createJmapResponseStream = (
  response: Response,
  options: {
    readonly expectedBytes?: number;
    readonly maxBytes: number;
    readonly onFinalize?: () => Promise<void> | void;
    readonly requireContentLength: boolean;
    readonly signal?: AbortSignal;
  },
): ReadableStream<Uint8Array> => {
  const declared = validateResponseLength(response, {
    ...options,
    requireIdentityEncoding: true,
  });
  const expectedBytes = options.expectedBytes ?? declared;
  if (!response.body) {
    if ((declared ?? options.expectedBytes ?? 0) === 0) {
      void options.onFinalize?.();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    }
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment body was missing.",
    );
  }
  return createBoundedAttachmentDownloadStream({
    errors: jmapStreamErrors(options.signal),
    ...(expectedBytes !== undefined ? { expectedBytes } : {}),
    maxBytes: options.maxBytes,
    ...(options.onFinalize ? { onFinalize: options.onFinalize } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    source: response.body,
  });
};

export const readJmapResponseBytes = async (
  response: Response,
  options: {
    readonly expectedBytes?: number;
    readonly maxBytes: number;
    readonly requireContentLength: boolean;
    readonly signal?: AbortSignal;
  },
): Promise<Uint8Array> => {
  const declared = validateResponseLength(response, options);

  const reader = response.body?.getReader();
  if (!reader) {
    if ((declared ?? options.expectedBytes ?? 0) === 0) return new Uint8Array();
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment body was missing.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await readJmapStreamWithAbort(reader, options.signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > options.maxBytes) {
        throw new JmapAttachmentTransportError(
          "size_limit_exceeded",
          "The attachment exceeds the configured size limit.",
        );
      }
      if (declared !== undefined && total > declared) {
        throw new JmapAttachmentTransportError(
          "content_length_mismatch",
          "Mail provider attachment content length did not match metadata.",
        );
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof JmapAttachmentTransportError) throw error;
    if (options.signal?.aborted) throw aborted();
    throw new JmapAttachmentTransportError(
      "network_error",
      "The mail provider attachment response failed.",
    );
  }
  if (
    (declared !== undefined && total !== declared) ||
    (options.expectedBytes !== undefined && total !== options.expectedBytes)
  ) {
    throw new JmapAttachmentTransportError(
      "content_length_mismatch",
      "Mail provider attachment content length did not match metadata.",
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
