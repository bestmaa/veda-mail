import { describe, expect, it } from "vitest";

import { collectAttachmentPreviewBody } from "@/server/mail/attachment-preview-body";

const stream = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

describe("attachment preview body collector", () => {
  it("collects exact chunks and wipes its fixed allocation on disposal", async () => {
    const collected = await collectAttachmentPreviewBody(
      stream(Uint8Array.of(1, 2), new Uint8Array(), Uint8Array.of(3)),
      3,
      16,
      new AbortController().signal,
    );

    expect(collected.bytes).toEqual(Uint8Array.of(1, 2, 3));
    collected.dispose();
    expect(collected.bytes).toEqual(Uint8Array.of(0, 0, 0));
    collected.dispose();
  });

  it("rejects provider length lies and over-limit bodies", async () => {
    await expect(
      collectAttachmentPreviewBody(
        stream(Uint8Array.of(1, 2)),
        3,
        4,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });

    await expect(
      collectAttachmentPreviewBody(
        stream(Uint8Array.of(1, 2, 3)),
        null,
        2,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
  });

  it("accepts valid progress across more than 65,536 tiny chunks", async () => {
    const size = 70_000;
    let emitted = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= size) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.of(emitted % 251));
        emitted += 1;
      },
    });

    const collected = await collectAttachmentPreviewBody(
      source,
      size,
      size,
      new AbortController().signal,
    );

    expect(collected.bytes.byteLength).toBe(size);
    expect(collected.bytes[69_999]).toBe(69_999 % 251);
    collected.dispose();
  });

  it("cancels a pending provider body when the request aborts", async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull() {
        return new Promise(() => undefined);
      },
    });
    const abort = new AbortController();
    const pending = collectAttachmentPreviewBody(
      source,
      null,
      16,
      abort.signal,
    );

    abort.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(cancelled).toBe(true);
  });
});
