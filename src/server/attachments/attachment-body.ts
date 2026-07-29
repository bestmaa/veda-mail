import type { AttachmentBody } from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

const abortedError = (): AttachmentQuarantineError =>
  new AttachmentQuarantineError(
    "Attachment upload was aborted.",
    "ATTACHMENT_UPLOAD_ABORTED",
    409,
  );

const isReadableStream = (
  body: AttachmentBody,
): body is ReadableStream<Uint8Array> =>
  typeof (body as ReadableStream<Uint8Array>).getReader === "function";

const iterateReadableStream = async function* (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  let completed = false;
  const cancel = (): void => {
    void reader.cancel(abortedError()).catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) {
        throw abortedError();
      }
      const result = await reader.read();
      if (result.done) {
        completed = true;
        return;
      }
      yield result.value;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
};

const nextWithAbort = <T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> =>
  new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(abortedError());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    void iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });

const iterateAsyncBody = async function* (
  body: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await nextWithAbort(iterator, signal);
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    if (signal.aborted) {
      void iterator.return?.().catch(() => undefined);
    }
  }
};

export const iterateAttachmentBody = (
  body: AttachmentBody,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> =>
  isReadableStream(body)
    ? iterateReadableStream(body, signal)
    : iterateAsyncBody(body, signal);
