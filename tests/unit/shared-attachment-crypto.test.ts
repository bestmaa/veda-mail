import { describe, expect, it } from "vitest";

import type { StoredAttachment } from
  "@/server/attachments/attachment-record";
import {
  decryptSharedAttachmentRecord,
  encryptSharedAttachmentRecord,
} from "@/server/attachments/shared-attachment-crypto";

const record: StoredAttachment = {
  bindings: {
    access: "a".repeat(64),
    draft: "b".repeat(64),
    session: "c".repeat(64),
  },
  contentLength: 42,
  createdAt: 1_700_000_000_000,
  declaredMimeType: "text/plain",
  detectedMimeType: "text/plain",
  encryptedFile: "attachment-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vma",
  expiresAt: 1_700_001_800_000,
  fileName: "private.txt",
  id: "a".repeat(32),
  sha256: "d".repeat(64),
  state: "clean",
};

describe("shared attachment metadata encryption", () => {
  it("round-trips authenticated records without operations", () => {
    const key = Buffer.alloc(32, 11);
    const serialized = encryptSharedAttachmentRecord(key, record);
    expect(serialized).not.toContain(record.fileName);
    expect(decryptSharedAttachmentRecord(key, record.id, serialized))
      .toEqual(record);
  });

  it("binds ciphertext to the key, id, and authentication tag", () => {
    const key = Buffer.alloc(32, 12);
    const serialized = encryptSharedAttachmentRecord(key, record);
    expect(() => decryptSharedAttachmentRecord(
      Buffer.alloc(32, 13), record.id, serialized,
    )).toThrow();
    expect(() => decryptSharedAttachmentRecord(
      key, "b".repeat(32), serialized,
    )).toThrow();
    const envelope = JSON.parse(serialized);
    const replacement = envelope.ciphertext.startsWith("A") ? "B" : "A";
    envelope.ciphertext = `${replacement}${envelope.ciphertext.slice(1)}`;
    expect(() => decryptSharedAttachmentRecord(
      key, record.id, JSON.stringify(envelope),
    )).toThrow();
  });
});
