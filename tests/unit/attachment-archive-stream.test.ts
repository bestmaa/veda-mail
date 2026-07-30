import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import type {
  Attachment,
  AttachmentDownload,
} from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { uniqueArchiveEntryNames } from "@/server/mail/attachment-archive-names";
import { createAttachmentArchiveStream } from "@/server/mail/attachment-archive-stream";
import { parseStoreZip } from "@/../tests/support/store-zip";

const messageId = id.message("archive-message");

const attachment = (
  index: number,
  name: string,
  size: number,
): Attachment => ({
  id: id.attachment(`archive-attachment-${index}`),
  mimeType: "application/octet-stream",
  name,
  size,
});

const download = (
  bytes: Uint8Array,
  size: number | null = bytes.byteLength,
): AttachmentDownload => ({
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }),
  mimeType: "application/octet-stream",
  name: "provider-name.bin",
  size,
});

const archive = (
  items: readonly Attachment[],
  downloads: readonly AttachmentDownload[],
  lifecycle?: {
    readonly controller?: AbortController;
    readonly finalize?: () => void;
  },
) => {
  const controller = lifecycle?.controller ?? new AbortController();
  const getDownload = vi.fn(async () => {
    const next = downloads[getDownload.mock.calls.length];
    if (!next) throw new Error("Unexpected attachment fetch.");
    return next;
  });
  return {
    getDownload,
    stream: createAttachmentArchiveStream({
      downloadAttachment: getDownload,
      entries: items.map((item, index) => ({
        attachment: item,
        name: uniqueArchiveEntryNames(items.map(({ name }) => name))[index] ??
          "attachment.bin",
      })),
      firstDownload: downloads[0] ?? download(new Uint8Array()),
      messageId,
      onCancel: (reason) => controller.abort(reason),
      onFinalize: lifecycle?.finalize ?? (() => undefined),
      signal: controller.signal,
    }),
  };
};

describe("attachment archive stream", () => {
  it("writes interoperable root-only STORE entries with exact bytes and CRC", async () => {
    const contents = [
      Uint8Array.of(0, 1, 2, 255),
      new TextEncoder().encode("नमस्ते"),
      new Uint8Array(),
    ];
    const items = [
      attachment(1, "../../report.txt", contents[0]?.byteLength ?? 0),
      attachment(2, "../../REPORT.txt", contents[1]?.byteLength ?? 0),
      attachment(3, "nul", 0),
    ];
    const { stream } = archive(
      items,
      contents.map((content) => download(content)),
    );
    const encoded = new Uint8Array(await new Response(stream).arrayBuffer());
    const parsed = parseStoreZip(encoded);
    const independentlyParsed = unzipSync(encoded);

    expect(parsed.map(({ name }) => name)).toEqual([
      "_.._report.txt",
      "_.._REPORT (2).txt",
      "attachment-nul",
    ]);
    expect(parsed.map(({ bytes }) => [...bytes])).toEqual(
      contents.map((content) => [...content]),
    );
    expect(Object.keys(independentlyParsed)).toEqual(
      parsed.map(({ name }) => name),
    );
    expect(
      Object.values(independentlyParsed).map((content) => [...content]),
    ).toEqual(contents.map((content) => [...content]));
    for (const entry of parsed) {
      expect(entry.method).toBe(0);
      expect(entry.flags & 0x0808).toBe(0x0808);
      expect(entry.externalAttributes >>> 28).toBe(0x8);
      expect(entry.time).toBe(0);
      expect(entry.date).toBe(0x21);
      expect(entry.name).not.toMatch(/[\\/]/u);
    }
  });

  it("resolves Unicode, case and post-truncation filename collisions", () => {
    const long = `${"a".repeat(220)}.pdf`;
    const names = uniqueArchiveEntryNames([
      "Résumé.pdf",
      "Re\u0301sume\u0301.PDF",
      long,
      long.toUpperCase(),
      "CON",
      "\u202eevil.txt",
    ]);

    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(6);
    expect(names[1]).toContain("(2)");
    expect(names[3]).toContain("(2)");
    expect(names.every((name) => new TextEncoder().encode(name).length <= 180))
      .toBe(true);
    expect(names.join("")).not.toContain("\u202e");
    expect(names[4]).toBe("attachment-CON");
  });

  it("does not open the next provider attachment before verified EOF", async () => {
    const first = attachment(1, "one.bin", 1);
    const second = attachment(2, "two.bin", 1);
    const secondDownload = download(Uint8Array.of(2));
    const { getDownload, stream } = archive(
      [first, second],
      [download(Uint8Array.of(1)), secondDownload],
    );
    const reader = stream.getReader();

    await reader.read();
    await reader.read();
    expect(getDownload).not.toHaveBeenCalled();
    await reader.read();
    expect(getDownload).not.toHaveBeenCalled();
    await reader.read();
    expect(getDownload).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it("fails closed on declared-size mismatch and zero-chunk floods", async () => {
    const short = archive(
      [attachment(1, "short.bin", 2)],
      [download(Uint8Array.of(1), 2)],
    );
    await expect(new Response(short.stream).arrayBuffer()).rejects.toMatchObject(
      { code: "provider_failure" },
    );

    const emptyFlood = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array());
      },
    });
    const flooded = archive(
      [attachment(1, "flood.bin", 0)],
      [{
        body: emptyFlood,
        mimeType: "application/octet-stream",
        name: "flood.bin",
        size: null,
      }],
    );
    await expect(
      new Response(flooded.stream).arrayBuffer(),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("cancels the active provider and finalizes exactly once", async () => {
    const cancelled = vi.fn();
    const finalized = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      cancel: cancelled,
      pull(controller) {
        controller.enqueue(Uint8Array.of(7));
      },
    });
    const { stream } = archive(
      [attachment(1, "large.bin", 0)],
      [{
        body: source,
        mimeType: "application/octet-stream",
        name: "large.bin",
        size: null,
      }],
      { finalize: finalized },
    );
    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel("browser closed");
    await Promise.resolve();

    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(finalized).toHaveBeenCalledTimes(1);
  });
});
