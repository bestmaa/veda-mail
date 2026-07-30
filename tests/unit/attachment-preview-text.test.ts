import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { inspectTextAttachmentPreview } from "@/server/mail/attachment-preview-text";

const detector = (
  mimeType = "text/plain",
): AttachmentMimeDetector => ({
  async detect() {
    return { mimeType, verdict: "accepted" };
  },
});

const cleanScanner = (
  inspected: Uint8Array[] = [],
): AttachmentScanner => ({
  async scan(content) {
    for await (const chunk of content) inspected.push(chunk.slice());
    return { verdict: "clean" };
  },
});

const inspect = (
  bytes: Uint8Array,
  dependencies?: {
    readonly mimeDetector?: AttachmentMimeDetector;
    readonly scanner?: AttachmentScanner;
  },
) =>
  inspectTextAttachmentPreview(
    {
      bytes,
      declaredMimeType: "text/plain",
      fileName: "notes.txt",
      signal: new AbortController().signal,
    },
    {
      mimeDetector: dependencies?.mimeDetector ?? detector(),
      scanner: dependencies?.scanner ?? cleanScanner(),
    },
  );

describe("attachment text preview inspection", () => {
  it("scans every byte before returning normalized inert UTF-8 text", async () => {
    const inspected: Uint8Array[] = [];
    const bytes = new TextEncoder().encode("first\rsecond\r\nthird\n");

    const output = await inspect(bytes, {
      scanner: cleanScanner(inspected),
    });

    expect(new TextDecoder().decode(output)).toBe("first\nsecond\nthird\n");
    expect(Buffer.concat(inspected.map((chunk) => Buffer.from(chunk)))).toEqual(
      Buffer.from(bytes),
    );
  });

  it("fails closed when the scanner skips bytes or reports infection", async () => {
    await expect(
      inspect(new TextEncoder().encode("safe-looking"), {
        scanner: {
          async scan() {
            return { verdict: "clean" };
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_SCANNER_UNAVAILABLE",
      status: 503,
    });

    await expect(
      inspect(new TextEncoder().encode("infected"), {
        scanner: {
          async scan(content) {
            for await (const _chunk of content) void _chunk;
            return { verdict: "infected" };
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_BLOCKED",
      status: 422,
    });
  });

  it("scans before rejecting unsupported declared or detected types", async () => {
    const scan = vi.fn(async (content: AsyncIterable<Uint8Array>) => {
      for await (const _chunk of content) void _chunk;
      return { verdict: "clean" as const };
    });
    await expect(
      inspectTextAttachmentPreview(
        {
          bytes: new TextEncoder().encode("<svg onload=alert(1)>"),
          declaredMimeType: "image/svg+xml",
          fileName: "attack.svg",
          signal: new AbortController().signal,
        },
        { mimeDetector: detector("image/svg+xml"), scanner: { scan } },
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_UNSUPPORTED",
      status: 415,
    });
    expect(scan).toHaveBeenCalledOnce();

    await expect(
      inspect(new TextEncoder().encode("%PDF-1.7"), {
        mimeDetector: detector("application/pdf"),
      }),
    ).rejects.toMatchObject({ code: "ATTACHMENT_PREVIEW_UNSUPPORTED" });
  });

  it.each([
    ["empty", new Uint8Array()],
    [
      "late invalid UTF-8",
      Uint8Array.from([
        ...new Uint8Array(8_193).fill(0x61),
        0xc3,
        0x28,
      ]),
    ],
    ["NUL", Uint8Array.from([0x61, 0, 0x62])],
    ["bidi override", new TextEncoder().encode("safe\u202Etxt")],
    ["C1 control", new TextEncoder().encode("safe\u0085txt")],
  ])("rejects %s content", async (_label, bytes) => {
    await expect(inspect(bytes)).rejects.toMatchObject({
      status: expect.any(Number),
    });
  });

  it("enforces line and code-point limits after newline normalization", async () => {
    await expect(
      inspect(new TextEncoder().encode("line\r".repeat(10_001))),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_TOO_LARGE",
      status: 413,
    });
    await expect(
      inspect(new TextEncoder().encode("a".repeat(100_001))),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_TOO_LARGE",
      status: 413,
    });
  });
});
