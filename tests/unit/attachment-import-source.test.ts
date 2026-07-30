import { describe, expect, it, vi } from "vitest";

import type { AttachmentDownload } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { fetchAttachmentImportSource } from "@/server/mail/attachment-import-source";

const input = (
  download: () => Promise<AttachmentDownload>,
  signal: AbortSignal,
) => ({
  attachmentId: id.attachment("source-attachment"),
  download,
  maximumBytes: 8,
  messageId: id.message("source-message"),
  signal,
});

describe("attachment import source", () => {
  it("does not invoke the provider when the import is already aborted", async () => {
    const abort = new AbortController();
    const download = vi.fn<() => Promise<AttachmentDownload>>();
    abort.abort();

    await expect(
      fetchAttachmentImportSource(input(download, abort.signal)),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(download).not.toHaveBeenCalled();
  });

  it("cancels a provider body exactly once when it resolves after abort", async () => {
    const abort = new AbortController();
    const deferred = Promise.withResolvers<AttachmentDownload>();
    const download = vi.fn(() => deferred.promise);
    const cancelled = vi.fn();
    const pending = fetchAttachmentImportSource(input(download, abort.signal));
    expect(download).toHaveBeenCalledOnce();

    abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });

    deferred.resolve({
      body: new ReadableStream<Uint8Array>({ cancel: cancelled }),
      mimeType: "application/octet-stream",
      name: "late.bin",
      size: 2,
    });
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(cancelled.mock.calls[0]?.[0]).toMatchObject({ code: "aborted" });
    await Promise.resolve();
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
