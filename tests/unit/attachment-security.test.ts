import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  normalizeAttachmentMimeType,
  parseAttachmentContentLength,
  sanitizeAttachmentFileName,
} from "@/server/attachments";
import {
  resolveAttachmentEncryptionKey,
  resolveAttachmentQuotas,
} from "@/server/attachments/attachment-security";
import {
  attachmentScope,
  quarantineFixture,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(
    path.join(os.tmpdir(), "veda-attachment-security-"),
  );
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("attachment security primitives", () => {
  it.each([
    ["../../etc/passwd", "_.._etc_passwd"],
    ["C:\\fakepath\\invoice.pdf", "C_fakepath_invoice.pdf"],
    ["report\u202egnp.exe", "report_gnp.exe"],
    ["\u0000\u0007", "attachment"],
    ["CON.txt", "attachment-CON.txt"],
    [".env", "env"],
  ])("sanitizes hostile filename %j", (input, expected) => {
    const safe = sanitizeAttachmentFileName(input);
    expect(safe).toBe(expected);
    expect(safe).not.toMatch(/[/\\]/u);
    expect(
      [...safe].some((character) => (character.codePointAt(0) ?? 0) < 0x20),
    ).toBe(false);
  });

  it("bounds normalized filenames by UTF-8 bytes", () => {
    const safe = sanitizeAttachmentFileName(`  ${"💣".repeat(200)}.txt  `);
    expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(180);
    expect(safe.endsWith(".")).toBe(false);
  });

  it.each([
    null,
    "",
    " 1",
    "+1",
    "-1",
    "1.0",
    "01",
    "1, 1",
    "9007199254740992",
    "not-a-number",
  ])("rejects non-canonical Content-Length %j", (value) => {
    expect(() => parseAttachmentContentLength(value)).toThrow(
      "valid Content-Length",
    );
  });

  it("accepts exact canonical safe Content-Length values", () => {
    expect(parseAttachmentContentLength("0")).toBe(0);
    expect(parseAttachmentContentLength("184467")).toBe(184467);
  });

  it("normalizes a MIME type while rejecting malformed values", () => {
    expect(normalizeAttachmentMimeType("Text/Plain; charset=utf-8")).toBe(
      "text/plain",
    );
    expect(() => normalizeAttachmentMimeType("text")).toThrow("media type");
    expect(() => normalizeAttachmentMimeType("text/plain\r\nX: y")).toThrow(
      "media type",
    );
  });

  it("requires coherent quotas and exactly 256-bit keys", () => {
    expect(() => resolveAttachmentEncryptionKey(Buffer.alloc(31))).toThrow(
      "32 bytes",
    );
    expect(() =>
      resolveAttachmentQuotas({
        maxAggregateBytesPerDraft: 2,
        maxBytesPerSession: 3,
        maxFileBytes: 4,
      }),
    ).toThrow("inconsistent");
    const injected = Buffer.alloc(32, 9);
    expect(resolveAttachmentEncryptionKey(injected)).toEqual(injected);
    expect(resolveAttachmentEncryptionKey(injected)).not.toBe(injected);
  });

  it("creates opaque 192-bit identifiers and never exposes binding data", async () => {
    const quarantine = quarantineFixture(directory, {
      quotas: { maxFilesPerDraft: 40 },
    });
    const reservations = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        quarantine.reserve({
          contentLength: index + 1,
          declaredMimeType: "application/octet-stream",
          fileName: "private.bin",
          scope: attachmentScope,
        }),
      ),
    );
    const ids = reservations.map(({ id }) => id);
    expect(new Set(ids)).toHaveLength(32);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{32}$/.test(id))).toBe(true);
    const serialized = JSON.stringify(reservations);
    expect(serialized).not.toContain(attachmentScope.ownerId);
    expect(serialized).not.toContain(attachmentScope.connectionId);
    expect(serialized).not.toContain(directory);
  });

  it("rejects control characters in owner and connection bindings", async () => {
    const quarantine = quarantineFixture(directory);
    await expect(
      quarantine.reserve({
        contentLength: 1,
        declaredMimeType: "text/plain",
        fileName: "safe.txt",
        scope: { ...attachmentScope, connectionId: "bad\nconnection" },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_ATTACHMENT_SCOPE",
      status: 400,
    });
  });
});
