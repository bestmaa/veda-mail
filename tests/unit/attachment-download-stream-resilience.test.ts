import { describe, expect, it, vi } from "vitest";

import { createBoundedAttachmentDownloadStream } from "@/infrastructure/providers/attachment-download-stream";

describe("bounded attachment download stream resilience", () => {
  it("rejects a provider that floods zero-byte chunks without progress", async () => {
    const cancelled = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      cancel: cancelled,
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
    });
    const bounded = createBoundedAttachmentDownloadStream({
      maxBytes: 1_024,
      source,
    });

    await expect(new Response(bounded).arrayBuffer()).rejects.toMatchObject({
      code: "provider_failure",
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("accepts valid progress across more than 65,536 small chunks", async () => {
    const expectedBytes = 65_537;
    let emitted = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === expectedBytes) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.of(emitted % 251));
        emitted += 1;
      },
    });
    const bounded = createBoundedAttachmentDownloadStream({
      expectedBytes,
      maxBytes: expectedBytes,
      source,
    });

    const received = new Uint8Array(await new Response(bounded).arrayBuffer());
    expect(received).toHaveLength(expectedBytes);
    expect(received[expectedBytes - 1]).toBe((expectedBytes - 1) % 251);
  }, 20_000);
});
