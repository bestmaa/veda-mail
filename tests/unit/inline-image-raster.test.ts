import { describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_RENDER_DIMENSION,
  normalizeInlineImageRaster,
} from "@/server/mail/inline-image-raster";

const png = (): Uint8Array =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );

describe("inline image raster normalization", () => {
  it("decodes a strict PNG and re-encodes a bounded metadata-free WebP", async () => {
    const output = await normalizeInlineImageRaster(
      png(),
      "image/png",
      new AbortController().signal,
    );

    expect(output.byteLength).toBeGreaterThan(0);
    expect(output.byteLength).toBeLessThanOrEqual(INLINE_IMAGE_MAX_BYTES);
    expect(Buffer.from(output.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(output.subarray(8, 12)).toString("ascii")).toBe("WEBP");
  });

  it("rejects MIME confusion and bytes appended after a valid image", async () => {
    await expect(
      normalizeInlineImageRaster(
        png(),
        "image/jpeg",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_UNSUPPORTED",
      status: 415,
    });

    const polyglot = Buffer.concat([
      png(),
      Buffer.from("<script>externalLeak()</script>"),
    ]);
    await expect(
      normalizeInlineImageRaster(
        polyglot,
        "image/png",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_UNSUPPORTED",
      status: 415,
    });
  });

  it("rejects empty and source-oversized inputs before decoding", async () => {
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(INLINE_IMAGE_MAX_BYTES + 1),
    ]) {
      await expect(
        normalizeInlineImageRaster(
          bytes,
          "image/png",
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        code: "INLINE_IMAGE_TOO_LARGE",
        status: 413,
      });
    }
  });

  it("downscales accepted source images to the browser render ceiling", async () => {
    const input = await sharp({
      create: {
        background: { alpha: 1, b: 20, g: 40, r: 60 },
        channels: 4,
        height: 1_000,
        width: 2_000,
      },
    })
      .png()
      .toBuffer();
    const output = await normalizeInlineImageRaster(
      input,
      "image/png",
      new AbortController().signal,
    );
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(INLINE_IMAGE_MAX_RENDER_DIMENSION);
    expect(metadata.height).toBe(800);
  });

  it("settles an aborted decode without emitting an unhandled stream error", async () => {
    const controller = new AbortController();
    const pending = normalizeInlineImageRaster(
      png(),
      "image/png",
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });
});
