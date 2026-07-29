import { describe, expect, it } from "vitest";

import type { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import {
  acquireAttachmentDownloadLease,
  createLeasedAttachmentDownloadStream,
} from "@/server/mail/attachment-download-concurrency";
import { ApiError } from "@/transport/http/api-error";

const stream = (
  chunks: readonly Uint8Array[],
): ReadableStream<Uint8Array> => {
  let index = 0;
  return new ReadableStream(
    {
      pull: (controller) => {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
};

describe("attachment download concurrency", () => {
  it("limits active streams per authenticated subject until EOF", async () => {
    const subject = crypto.randomUUID();
    const first = acquireAttachmentDownloadLease(subject);
    const second = acquireAttachmentDownloadLease(subject);
    const third = acquireAttachmentDownloadLease(subject);
    expect(() => acquireAttachmentDownloadLease(subject)).toThrow(ApiError);

    const body = createLeasedAttachmentDownloadStream({
      expectedBytes: 1,
      lease: first,
      maxBytes: 2,
      source: stream([new Uint8Array([1])]),
    });
    await expect(
      new Response(body).arrayBuffer().then((value) => value.byteLength),
    ).resolves.toBe(1);
    const replacement = acquireAttachmentDownloadLease(subject);

    replacement.release();
    second.release();
    third.release();
  });

  it("releases exactly once when the consumer cancels", async () => {
    const subject = crypto.randomUUID();
    const first = acquireAttachmentDownloadLease(subject);
    const second = acquireAttachmentDownloadLease(subject);
    const third = acquireAttachmentDownloadLease(subject);
    const source = new ReadableStream<Uint8Array>({ pull: () => undefined });
    const body = createLeasedAttachmentDownloadStream({
      lease: first,
      maxBytes: 10,
      source,
    });

    await body.cancel("consumer disconnected");
    first.release();
    const replacement = acquireAttachmentDownloadLease(subject);

    replacement.release();
    second.release();
    third.release();
  });

  it("preserves backpressure and rejects a stream over its byte cap", async () => {
    let pulls = 0;
    const lease = acquireAttachmentDownloadLease(crypto.randomUUID());
    const source = new ReadableStream<Uint8Array>(
      {
        pull: (controller) => {
          pulls += 1;
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
      },
      { highWaterMark: 0 },
    );
    const body = createLeasedAttachmentDownloadStream({
      lease,
      maxBytes: 2,
      source,
    });
    expect(pulls).toBe(0);

    const reader = body.getReader();
    await expect(reader.read()).rejects.toMatchObject({
      code: "size_limit_exceeded",
    });
    expect(pulls).toBe(1);
  });

  it("rejects incomplete known-length streams and releases their slot", async () => {
    const subject = crypto.randomUUID();
    const lease = acquireAttachmentDownloadLease(subject);
    const body = createLeasedAttachmentDownloadStream({
      expectedBytes: 2,
      lease,
      maxBytes: 2,
      source: stream([new Uint8Array([1])]),
    });

    await expect(new Response(body).arrayBuffer()).rejects.toMatchObject({
      code: "provider_failure",
    } satisfies Partial<AttachmentDownloadError>);
    const next = acquireAttachmentDownloadLease(subject);
    next.release();
  });

  it("cancels and releases an active stream when the request aborts", async () => {
    const subject = crypto.randomUUID();
    const abort = new AbortController();
    const lease = acquireAttachmentDownloadLease(subject);
    const body = createLeasedAttachmentDownloadStream({
      lease,
      maxBytes: 10,
      signal: abort.signal,
      source: new ReadableStream<Uint8Array>({ pull: () => undefined }),
    });
    const reader = body.getReader();

    abort.abort();

    await expect(reader.read()).rejects.toMatchObject({ code: "aborted" });
    const next = acquireAttachmentDownloadLease(subject);
    next.release();
  });
});
