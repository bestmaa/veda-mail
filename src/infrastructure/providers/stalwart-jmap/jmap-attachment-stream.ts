import "server-only";

import {
  JmapAttachmentTransportError,
  type JmapAttachmentRequestBody,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";

const aborted = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "aborted",
    "The attachment operation was cancelled.",
  );
export const throwIfAttachmentAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw aborted();
};
export const readJmapStreamWithAbort = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> => {
  throwIfAttachmentAborted(signal);
  if (!signal) return reader.read();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = (): void => {
      if (!finish()) return;
      void reader.cancel().catch(() => undefined);
      reject(aborted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (result) => {
        if (finish()) resolve(result);
      },
      (error: unknown) => {
        if (finish()) reject(error);
      },
    );
  });
};
const exactUploadStream = (
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = source.getReader();
  } catch {
    throw new JmapAttachmentTransportError(
      "invalid_input",
      "Attachment byte stream was already locked.",
    );
  }
  let seen = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const current = await readJmapStreamWithAbort(reader, signal);
        if (current.done) {
          if (seen !== expectedBytes) {
            throw new JmapAttachmentTransportError(
              "content_length_mismatch",
              "Attachment content length did not match its declaration.",
            );
          }
          controller.close();
          return;
        }
        if (!(current.value instanceof Uint8Array)) {
          throw new JmapAttachmentTransportError(
            "invalid_input",
            "Attachment streams must contain byte chunks.",
          );
        }
        const nextSeen = seen + current.value.byteLength;
        if (nextSeen > expectedBytes) {
          throw new JmapAttachmentTransportError(
            "content_length_mismatch",
            "Attachment content length did not match its declaration.",
          );
        }
        if (nextSeen === expectedBytes) {
          const lookahead = await readJmapStreamWithAbort(reader, signal);
          if (!lookahead.done) {
            throw new JmapAttachmentTransportError(
              "content_length_mismatch",
              "Attachment content length did not match its declaration.",
            );
          }
          controller.enqueue(current.value);
          controller.close();
          seen = nextSeen;
          return;
        }
        seen = nextSeen;
        controller.enqueue(current.value);
      } catch (error) {
        void reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
};
export const prepareJmapUploadBody = (
  body: JmapAttachmentRequestBody,
  expectedBytes: number,
  signal?: AbortSignal,
): BodyInit => {
  throwIfAttachmentAborted(signal);
  if (body instanceof Uint8Array) {
    if (body.byteLength !== expectedBytes) {
      throw new JmapAttachmentTransportError(
        "content_length_mismatch",
        "Attachment content length did not match its declaration.",
      );
    }
    const bytes = new ArrayBuffer(body.byteLength);
    new Uint8Array(bytes).set(body);
    return bytes;
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.getReader !== "function"
  ) {
    throw new JmapAttachmentTransportError(
      "invalid_input",
      "Attachment content must be bytes or a byte stream.",
    );
  }
  return exactUploadStream(body, expectedBytes, signal);
};
