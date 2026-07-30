import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentDownload,
  MessageAttachmentMetadata,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { createAttachmentArchiveStream } from "@/server/mail/attachment-archive-stream";
import { parseStoreZip } from "@/../tests/support/store-zip";

const messageId = id.message("archive-edge-cases");
const item = (size: number | null = null): MessageAttachmentMetadata => ({
  disposition: "attachment",
  id: id.attachment("attachment-edge-case"),
  mimeType: "application/octet-stream",
  name: "edge.bin",
  size,
});

const archive = (
  firstDownload: AttachmentDownload,
  onCancel = vi.fn(),
) => {
  const controller = new AbortController();
  return createAttachmentArchiveStream({
    downloadAttachment: vi.fn(),
    entries: [{ attachment: item(firstDownload.size), name: "edge.bin" }],
    firstDownload,
    messageId,
    onCancel: (reason) => {
      onCancel(reason);
      controller.abort(reason);
    },
    onFinalize: vi.fn(),
    signal: controller.signal,
  });
};

describe("attachment archive stream edge cases", () => {
  it("cancels the eager provider body when never pulled", async () => {
    const cancelled = vi.fn();
    const stream = archive({
      body: new ReadableStream({ cancel: cancelled }),
      mimeType: "application/octet-stream",
      name: "edge.bin",
      size: null,
    });

    await stream.cancel("unused response");
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  });

  it("cancels exactly once after only the local header was read", async () => {
    const cancelled = vi.fn();
    const stream = archive({
      body: new ReadableStream({
        cancel: cancelled,
        pull(controller) {
          controller.enqueue(Uint8Array.of(1));
        },
      }),
      mimeType: "application/octet-stream",
      name: "edge.bin",
      size: null,
    });
    const reader = stream.getReader();

    const header = await reader.read();
    expect(header.value?.byteLength).toBeGreaterThan(0);
    await reader.cancel("header only");
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  });

  it("redacts raw provider stream errors", async () => {
    const stream = archive({
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("private-provider.example/blob/secret"));
        },
      }),
      mimeType: "application/octet-stream",
      name: "edge.bin",
      size: null,
    });

    let observed: unknown;
    try {
      await new Response(stream).arrayBuffer();
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({
      code: "provider_failure",
      message: expect.not.stringContaining("private-provider"),
    });
  });

  it("archives valid progress across more than 65,536 chunks", async () => {
    const expectedBytes = 65_537;
    let emitted = 0;
    const stream = archive({
      body: new ReadableStream({
        pull(controller) {
          if (emitted === expectedBytes) {
            controller.close();
            return;
          }
          controller.enqueue(Uint8Array.of(emitted % 251));
          emitted += 1;
        },
      }),
      mimeType: "application/octet-stream",
      name: "edge.bin",
      size: expectedBytes,
    });

    const encoded = new Uint8Array(await new Response(stream).arrayBuffer());
    const [entry] = parseStoreZip(encoded);
    expect(entry?.bytes).toHaveLength(expectedBytes);
    expect(entry?.bytes[expectedBytes - 1]).toBe((expectedBytes - 1) % 251);
  }, 20_000);
});
