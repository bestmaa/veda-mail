import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  toBuffer: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: vi.fn(() => {
    const pipeline = {
      metadata: vi.fn(async () => ({
        format: "png",
        height: 1,
        pages: 1,
        width: 1,
      })),
      resize: vi.fn(),
      rotate: vi.fn(),
      timeout: vi.fn(),
      toBuffer: mocks.toBuffer,
      webp: vi.fn(),
    };
    pipeline.resize.mockReturnValue(pipeline);
    pipeline.rotate.mockReturnValue(pipeline);
    pipeline.timeout.mockReturnValue(pipeline);
    pipeline.webp.mockReturnValue(pipeline);
    return pipeline;
  }),
}));

import { normalizeInlineImageRaster } from "@/server/mail/inline-image-raster";

const png = (): Uint8Array =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inline image raster processor timeout", () => {
  it("maps Sharp's recognizable libvips timeout to a gateway timeout", async () => {
    mocks.toBuffer.mockRejectedValue(
      new Error("timeout: 42% complete"),
    );

    await expect(
      normalizeInlineImageRaster(
        png(),
        "image/png",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_PROCESSOR_TIMEOUT",
      status: 504,
    });
  });
});
