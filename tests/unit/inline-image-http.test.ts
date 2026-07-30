import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInlineImageResponse,
  inlineImageHeaders,
} from "@/server/mail/inline-image-http";

const prepared = (value = new Uint8Array([1, 2, 3])) => ({
  bytes: value,
  dispose: vi.fn(() => value.fill(0)),
  mimeType: "image/webp" as const,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("inline image HTTP response", () => {
  it("delivers bounded WebP with hardened headers and disposes bytes", async () => {
    const image = prepared(Buffer.from([1, 2, 3]));
    const response = createInlineImageResponse(image);

    expect(inlineImageHeaders().get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="inline-image.webp"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(image.dispose).toHaveBeenCalledOnce();
    expect(image.bytes.every((value) => value === 0)).toBe(true);
  });

  it("releases an unconsumed response at its delivery deadline", async () => {
    vi.useFakeTimers();
    const image = prepared();
    const response = createInlineImageResponse(image, undefined, 20);

    await vi.advanceTimersByTimeAsync(20);

    expect(image.dispose).toHaveBeenCalledOnce();
    await expect(response.arrayBuffer()).rejects.toMatchObject({
      code: "INLINE_IMAGE_RESPONSE_TIMEOUT",
      status: 504,
    });
  });

  it("disposes exactly once on cancellation, abort, or invalid metadata", async () => {
    const cancelled = prepared();
    const cancelledResponse = createInlineImageResponse(cancelled);
    await cancelledResponse.body?.cancel();
    expect(cancelled.dispose).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const aborted = prepared();
    const abortedResponse = createInlineImageResponse(
      aborted,
      controller.signal,
    );
    controller.abort();
    await expect(abortedResponse.arrayBuffer()).rejects.toMatchObject({
      code: "INLINE_IMAGE_ABORTED",
      status: 499,
    });
    expect(aborted.dispose).toHaveBeenCalledOnce();

    const invalid = {
      ...prepared(),
      mimeType: "image/png",
    };
    expect(() =>
      createInlineImageResponse(
        invalid as unknown as Parameters<typeof createInlineImageResponse>[0],
      ),
    ).toThrow("could not be prepared");
    expect(invalid.dispose).toHaveBeenCalledOnce();
  });
});
