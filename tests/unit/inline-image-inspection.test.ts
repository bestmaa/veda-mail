import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { inspectInlineImage } from "@/server/mail/inline-image-inspection";

const bytes = new Uint8Array([1, 2, 3, 4]);

const detector = (mimeType: string): AttachmentMimeDetector => ({
  async detect() {
    return { mimeType, verdict: "accepted" };
  },
});

const scanner = (verdict: "clean" | "infected" = "clean"): AttachmentScanner => ({
  async scan(content) {
    for await (const _chunk of content) void _chunk;
    return { verdict };
  },
});

describe("inline image inspection", () => {
  it.each(["image/png", "image/jpeg", "image/webp"] as const)(
    "scans every byte and accepts matching %s through the raster normalizer",
    async (mimeType) => {
      let scanned = 0;
      const normalizer = vi.fn(async (input: Uint8Array) =>
        new Uint8Array(input),
      );
      const output = await inspectInlineImage(
        {
          bytes,
          declaredMimeType: mimeType,
          fileName: "inline-image.bin",
          signal: new AbortController().signal,
        },
        {
          mimeDetector: detector(mimeType),
          normalizer,
          scanner: {
            async scan(content) {
              for await (const chunk of content) {
                scanned += chunk.byteLength;
              }
              return { verdict: "clean" };
            },
          },
        },
      );

      expect(scanned).toBe(bytes.byteLength);
      expect(normalizer).toHaveBeenCalledWith(
        bytes,
        mimeType,
        expect.any(AbortSignal),
      );
      expect(output).toEqual(bytes);
    },
  );

  it.each([
    ["image/svg+xml", "image/svg+xml"],
    ["text/html", "text/html"],
    ["application/pdf", "application/pdf"],
    ["image/png", "image/jpeg"],
  ])(
    "rejects declared %s detected as %s",
    async (declaredMimeType, detectedMimeType) => {
      await expect(
        inspectInlineImage(
          {
            bytes,
            declaredMimeType,
            fileName: "unsafe.bin",
            signal: new AbortController().signal,
          },
          {
            mimeDetector: detector(detectedMimeType),
            normalizer: vi.fn(),
            scanner: scanner(),
          },
        ),
      ).rejects.toMatchObject({
        code: "INLINE_IMAGE_UNSUPPORTED",
        status: 415,
      });
    },
  );

  it("rejects unsupported declared types before invoking security services", async () => {
    const mimeDetector = { detect: vi.fn() };
    const attachmentScanner = { scan: vi.fn() };

    await expect(
      inspectInlineImage(
        {
          bytes,
          declaredMimeType: "image/svg+xml",
          fileName: "active.svg",
          signal: new AbortController().signal,
        },
        {
          mimeDetector,
          normalizer: vi.fn(),
          scanner: attachmentScanner,
        },
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_UNSUPPORTED",
      status: 415,
    });
    expect(mimeDetector.detect).not.toHaveBeenCalled();
    expect(attachmentScanner.scan).not.toHaveBeenCalled();
  });

  it("fails closed for an infected verdict or unavailable scanner", async () => {
    await expect(
      inspectInlineImage(
        {
          bytes,
          declaredMimeType: "image/png",
          fileName: "infected.png",
          signal: new AbortController().signal,
        },
        {
          mimeDetector: detector("image/png"),
          normalizer: vi.fn(),
          scanner: scanner("infected"),
        },
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_BLOCKED",
      status: 422,
    });

    await expect(
      inspectInlineImage(
        {
          bytes,
          declaredMimeType: "image/png",
          fileName: "unscanned.png",
          signal: new AbortController().signal,
        },
        {
          mimeDetector: detector("image/png"),
          normalizer: vi.fn(),
          scanner: {
            async scan() {
              throw new Error("private scanner endpoint");
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "INLINE_IMAGE_SCANNER_UNAVAILABLE",
      status: 503,
    });
  });
});
