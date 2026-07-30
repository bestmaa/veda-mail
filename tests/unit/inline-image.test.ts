import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { id } from "@/domain/shared/brand";
import {
  type InlineImageDependencies,
  prepareInlineImage,
} from "@/server/mail/inline-image";
import { INLINE_IMAGE_MAX_BYTES } from "@/server/mail/inline-image-raster";

const sourceBytes = new Uint8Array([1, 2, 3, 4]);
const normalizedBytes = new Uint8Array([5, 6, 7]);

const body = (value: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });

const detector: AttachmentMimeDetector = {
  async detect() {
    return { mimeType: "image/png", verdict: "accepted" };
  },
};

const scanner: AttachmentScanner = {
  async scan(content) {
    for await (const _chunk of content) void _chunk;
    return { verdict: "clean" };
  },
};

const dependencies = (): InlineImageDependencies => ({
  download: vi.fn(async () => ({
    body: body(sourceBytes),
    mimeType: "image/png",
    name: "logo.png",
    size: sourceBytes.byteLength,
  })),
  mimeDetector: detector,
  normalizer: vi.fn(async () => new Uint8Array(normalizedBytes)),
  scanner,
});

const input = (subject = crypto.randomUUID(), signal?: AbortSignal) => ({
  attachmentId: id.attachment("opaque-inline-attachment"),
  messageId: id.message("opaque-inline-message"),
  ...(signal ? { signal } : {}),
  subject,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("inline image preparation", () => {
  it("re-resolves opaque IDs, returns canonical WebP, and wipes on dispose", async () => {
    const deps = dependencies();
    const prepared = await prepareInlineImage(input(), deps);

    expect(prepared.mimeType).toBe("image/webp");
    expect(prepared.bytes).toEqual(normalizedBytes);
    expect(deps.download).toHaveBeenCalledWith({
      attachmentId: "opaque-inline-attachment",
      maxBytes: INLINE_IMAGE_MAX_BYTES,
      messageId: "opaque-inline-message",
      signal: expect.any(AbortSignal),
    });
    prepared.dispose();
    expect(prepared.bytes.every((value) => value === 0)).toBe(true);
    prepared.dispose();
  });

  it("rejects provider-declared oversized content before reading it", async () => {
    const cancel = vi.fn();
    const deps: InlineImageDependencies = {
      ...dependencies(),
      download: vi.fn(async () => ({
        body: new ReadableStream({ cancel }),
        mimeType: "image/png",
        name: "huge.png",
        size: INLINE_IMAGE_MAX_BYTES + 1,
      })),
    };

    await expect(
      prepareInlineImage(input(), deps),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_TOO_LARGE",
      status: 413,
    });
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("holds at most two prepared images per subject until disposal", async () => {
    const subject = crypto.randomUUID();
    const first = await prepareInlineImage(input(subject), dependencies());
    const second = await prepareInlineImage(input(subject), dependencies());

    await expect(
      prepareInlineImage(input(subject), dependencies()),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_BUSY",
      status: 429,
    });

    first.dispose();
    const retry = await prepareInlineImage(input(subject), dependencies());
    retry.dispose();
    second.dispose();
  });

  it("times out a processor that ignores abort and releases its lease", async () => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const subject = crypto.randomUUID();
    const deps: InlineImageDependencies = {
      ...dependencies(),
      normalizer: async () => {
        entered.resolve();
        return new Promise(() => undefined);
      },
      timeoutMs: 20,
    };
    const pending = prepareInlineImage(input(subject), deps);
    await entered.promise;
    const rejection = expect(pending).rejects.toMatchObject({
      code: "INLINE_IMAGE_TIMEOUT",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    const retry = await prepareInlineImage(input(subject), dependencies());
    retry.dispose();
  });
});
