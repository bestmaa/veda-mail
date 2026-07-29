import { describe, expect, it } from "vitest";

import {
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import { attachmentContentDisposition } from "@/server/mail/attachment-download-http";

describe("received attachment metadata", () => {
  it.each([
    [
      "../safe\r\nBcc: victim@example.com.txt",
      "_safe_Bcc_ victim@example.com.txt",
    ],
    ["CON.txt", "attachment-CON.txt"],
    ["photo\u202Egnp.exe", "photo_gnp.exe"],
    ["\uD800broken.txt", "�broken.txt"],
    ["   ", "attachment.bin"],
  ])("sanitizes filename %j", (input, expected) => {
    expect(sanitizeReceivedAttachmentName(input)).toBe(expected);
  });

  it("keeps filenames within the UTF-8 byte ceiling and preserves extensions", () => {
    const name = sanitizeReceivedAttachmentName(`${"界".repeat(200)}.pdf`);

    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(180);
    expect(name).toMatch(/\.pdf$/u);
  });

  it("creates injection-safe ASCII and RFC 8187 disposition parameters", () => {
    const header = attachmentContentDisposition(
      'réport\r\n"../../quarterly (final)%.pdf',
    );

    expect(header).toMatch(/^attachment; filename="/u);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain("%C3%A9");
    expect(header).not.toMatch(/[\r\n]/u);
    expect(header).not.toContain("../");
  });

  it("normalizes declared media types only for display metadata", () => {
    expect(normalizeReceivedAttachmentMimeType(" IMAGE/PNG; charset=x ")).toBe(
      "image/png",
    );
    expect(
      normalizeReceivedAttachmentMimeType("text/html\r\nX-Evil: yes"),
    ).toBe("application/octet-stream");
    expect(normalizeReceivedAttachmentMimeType(undefined)).toBe(
      "application/octet-stream",
    );
  });
});
