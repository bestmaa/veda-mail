import { describe, expect, it } from "vitest";

import {
  assertSafeMimeBoundary,
  createMimeBoundary,
  formatAttachmentContentDisposition,
  normalizeAttachmentFilename,
  normalizeAttachmentMimeType,
} from "@/infrastructure/providers/imap-smtp/mime-attachment-headers";
import {
  encodeMimeBase64,
  renderMimeAttachmentPart,
  renderMimeClosingBoundary,
  type MimeBinarySource,
} from "@/infrastructure/providers/imap-smtp/mime-base64-stream";

const collect = async (source: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return Buffer.concat(chunks);
};

describe("MIME attachment headers", () => {
  it("emits an escaped ASCII fallback and RFC 5987 UTF-8 filename", () => {
    const value = formatAttachmentContentDisposition(
      'résumé "final"\\2026.pdf',
    );

    expect(value).toContain('filename="r_sum_ \\"final\\"_2026.pdf"');
    expect(value).toContain(
      "filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22_2026.pdf",
    );
  });

  it("normalizes path separators, controls, and empty filenames", () => {
    expect(normalizeAttachmentFilename("../a/b\u0000.txt")).toBe(".._a_b_.txt");
    expect(normalizeAttachmentFilename("   ")).toBe("attachment.bin");
  });

  it("bounds long filenames without dropping a short extension", () => {
    const filename = normalizeAttachmentFilename(`${"界".repeat(200)}.pdf`);
    const header = formatAttachmentContentDisposition(filename);

    expect(Buffer.byteLength(filename, "utf8")).toBeLessThanOrEqual(180);
    expect(filename).toMatch(/\.pdf$/);
    expect(header.length).toBeLessThan(998);
    expect(header).not.toContain("\r");
  });

  it("rejects CRLF injection in all header-controlled values", () => {
    expect(() =>
      formatAttachmentContentDisposition("safe.txt\r\nBcc: victim@test"),
    ).toThrow(/CR or LF/);
    expect(() =>
      normalizeAttachmentMimeType("text/plain\nX-Evil: yes"),
    ).toThrow(/CR or LF/);
    expect(() => assertSafeMimeBoundary("safe\r\n--evil")).toThrow(/CR or LF/);
    expect(() =>
      formatAttachmentContentDisposition(
        "safe.txt",
        "attachment\r\nX-Evil: yes" as "attachment",
      ),
    ).toThrow(/disposition/);
  });

  it("normalizes safe MIME types and falls back for invalid ones", () => {
    expect(normalizeAttachmentMimeType(" IMAGE/PNG; charset=binary ")).toBe(
      "image/png",
    );
    expect(normalizeAttachmentMimeType("text / plain")).toBe(
      "application/octet-stream",
    );
    expect(normalizeAttachmentMimeType(undefined)).toBe(
      "application/octet-stream",
    );
  });

  it("creates unique boundaries with deterministic injection support", () => {
    const deterministic = createMimeBoundary(() =>
      Uint8Array.from({ length: 24 }, (_, index) => index),
    );
    expect(deterministic).toBe(
      "veda_000102030405060708090a0b0c0d0e0f1011121314151617",
    );
    expect(createMimeBoundary()).not.toBe(createMimeBoundary());
    expect(() => createMimeBoundary(() => new Uint8Array(23))).toThrow(
      /24 bytes/,
    );
    expect(() => assertSafeMimeBoundary("unsafe boundary")).toThrow(
      /unsupported/,
    );
  });
});

describe("streaming MIME Base64", () => {
  it("emits no content for empty and zero-length chunks", async () => {
    const encoded = await collect(
      encodeMimeBase64([new Uint8Array(), Buffer.alloc(0)]),
    );
    expect(encoded).toHaveLength(0);
  });

  it("preserves bytes across arbitrary chunks with RFC 2045 lines", async () => {
    const original = Buffer.from(
      Array.from({ length: 4_097 }, (_, index) => index % 251),
    );
    const source = [
      original.subarray(0, 1),
      new Uint8Array(),
      original.subarray(1, 59),
      original.subarray(59, 2_000),
      original.subarray(2_000),
    ];
    const encoded = await collect(encodeMimeBase64(source));
    const lines = encoded.toString("ascii").split("\r\n");

    expect(lines.at(-1)).toBe("");
    expect(lines[0]).toHaveLength(76);
    expect(lines.slice(0, -1).every((line) => line.length <= 76)).toBe(true);
    expect(Buffer.from(lines.join(""), "base64")).toEqual(original);
  });

  it("keeps output bounded when one input chunk is large", async () => {
    const large = Buffer.alloc(512 * 1024, 0xab);
    let emitted = 0;
    for await (const chunk of encodeMimeBase64([large])) {
      expect(chunk.byteLength).toBeLessThanOrEqual(78);
      emitted += chunk.byteLength;
    }
    expect(emitted).toBeGreaterThan(large.byteLength);
  });

  it("renders a lazy attachment part and safe closing boundary", async () => {
    let sourceReads = 0;
    const source: MimeBinarySource = {
      async *[Symbol.asyncIterator]() {
        sourceReads += 1;
        yield Buffer.from("hello");
      },
    };
    const iterator = renderMimeAttachmentPart({
      boundary: "fixed_boundary",
      content: source,
      contentId: "logo@example.test",
      contentType: "Text/Plain",
      disposition: "inline",
      filename: "hello.txt",
    });
    const header = await iterator.next();

    expect(sourceReads).toBe(0);
    expect(header.value?.toString("ascii")).toContain(
      "Content-Disposition: inline;",
    );
    expect(header.value?.toString("ascii")).toContain(
      "Content-ID: <logo@example.test>\r\n",
    );
    const encoded = await collect(iterator);
    expect(encoded.toString("ascii")).toBe("aGVsbG8=\r\n");
    expect(renderMimeClosingBoundary("fixed_boundary").toString()).toBe(
      "--fixed_boundary--\r\n",
    );
  });

  it("rejects boundary and Content-ID injection before reading content", async () => {
    const unsafeBoundary = renderMimeAttachmentPart({
      boundary: "bad\r\nboundary",
      content: [],
      filename: "safe.txt",
    });
    await expect(unsafeBoundary.next()).rejects.toThrow(/CR or LF/);

    const unsafeId = renderMimeAttachmentPart({
      boundary: "safe_boundary",
      content: [],
      contentId: "safe@test\r\nBcc: victim@test",
      filename: "safe.txt",
    });
    await expect(unsafeId.next()).rejects.toThrow(/CR or LF/);

    const unbalancedId = renderMimeAttachmentPart({
      boundary: "safe_boundary",
      content: [],
      contentId: "<safe@test",
      filename: "safe.txt",
    });
    await expect(unbalancedId.next()).rejects.toThrow(/balanced/);
  });
});
