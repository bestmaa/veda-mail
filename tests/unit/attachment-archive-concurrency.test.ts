import { describe, expect, it } from "vitest";

import { acquireAttachmentArchiveLease } from "@/server/mail/attachment-archive-concurrency";

describe("attachment archive concurrency", () => {
  it("allows one active archive per subject and releases idempotently", () => {
    const lease = acquireAttachmentArchiveLease("archive-subject");
    try {
      expect(() =>
        acquireAttachmentArchiveLease("archive-subject"),
      ).toThrowError(expect.objectContaining({
        code: "ATTACHMENT_ARCHIVE_BUSY",
        status: 429,
      }));
    } finally {
      lease.release();
      lease.release();
    }
    const retry = acquireAttachmentArchiveLease("archive-subject");
    retry.release();
  });

  it("bounds active archives globally", () => {
    const leases = Array.from({ length: 4 }, (_, index) =>
      acquireAttachmentArchiveLease(`global-archive-${index}`),
    );
    try {
      expect(() =>
        acquireAttachmentArchiveLease("global-archive-overflow"),
      ).toThrowError(expect.objectContaining({
        code: "ATTACHMENT_ARCHIVE_BUSY",
        status: 429,
      }));
    } finally {
      for (const lease of leases) lease.release();
    }
  });
});
