import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { id } from "@/domain/shared/brand";
import type { AttachmentScope, AttachmentSnapshot } from "@/server/attachments";
import {
  acquireAttachmentDownloadLease,
  type AttachmentDownloadLease,
} from "@/server/mail/attachment-download-concurrency";
import {
  importReceivedAttachment,
  type AttachmentImportDependencies,
} from "@/server/mail/attachment-import";
import { AttachmentSendMemoryBudget } from "@/server/mail/attachment-send-memory-budget";

const limit = 8;
const scope: AttachmentScope = {
  connectionId: "resource-connection",
  draftId: "resource-draft",
  ownerId: "resource@example.com",
  sessionId: "resource-session",
};

afterEach(() => {
  vi.useRealTimers();
});

const input = (subject: string, signal?: AbortSignal) => ({
  attachmentId: id.attachment("opaque-resource-attachment"),
  messageId: id.message("opaque-resource-message"),
  scope,
  ...(signal ? { signal } : {}),
  subject,
});

const stream = (value = "ok") =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(value));
      controller.close();
    },
  });

const snapshot = (
  state: AttachmentSnapshot["state"],
  contentLength = 2,
): AttachmentSnapshot => ({
  contentLength,
  createdAt: "2026-07-30T10:00:00.000Z",
  detectedMimeType: "text/plain",
  expiresAt: "2026-07-30T10:30:00.000Z",
  fileName: "forwarded.txt",
  id: "b".repeat(32),
  state,
});

const quarantine = () => ({
  remove: vi.fn(async () => undefined),
  reserve: vi.fn(async (reservation: { contentLength: number }) =>
    snapshot("reserved", reservation.contentLength),
  ),
  upload: vi.fn(
    async (
      _id: string,
      _scope: AttachmentScope,
      body: AsyncIterable<Uint8Array>,
      contentLength: number,
    ) => {
      let observed = 0;
      for await (const chunk of body) observed += chunk.byteLength;
      if (observed !== contentLength) throw new Error("length mismatch");
      return snapshot("clean", contentLength);
    },
  ),
});

const dependencies = (
  download: AttachmentImportDependencies["download"],
  budget = new AttachmentSendMemoryBudget({
    capacityBytes: limit,
    waitTimeoutMs: 20,
  }),
): AttachmentImportDependencies => ({
  download,
  maximumBytes: limit,
  memoryBudget: budget,
  quarantine: quarantine(),
  timeoutMs: 100,
});

const cleanDownload: AttachmentImportDependencies["download"] = async () => ({
  body: stream(),
  mimeType: "text/plain",
  name: "forwarded.txt",
  size: 2,
});

describe("attachment import resource settlement", () => {
  it("aborts mid-source even when provider cancellation never settles", async () => {
    const entered = Promise.withResolvers<void>();
    const abort = new AbortController();
    let pulls = 0;
    let cancelled = false;
    const hanging = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => undefined);
      },
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array([1]));
        else entered.resolve();
      },
    });
    const pending = importReceivedAttachment(
      input("mid-source", abort.signal),
      dependencies(async () => ({
        body: hanging,
        mimeType: "application/octet-stream",
        name: "partial.bin",
        size: null,
      })),
    );
    await entered.promise;

    abort.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(cancelled).toBe(true);
  });

  it("preserves a structured provider error raised mid-stream", async () => {
    const cleanupLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const original = new AttachmentDownloadError(
      "timeout",
      "private provider timeout detail",
    );
    let pulls = 0;
    const failed = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new Uint8Array([1]));
        else controller.error(original);
      },
    });

    await expect(
      importReceivedAttachment(
        input("midstream-error"),
        dependencies(async () => ({
          body: failed,
          mimeType: "application/octet-stream",
          name: "partial.bin",
          size: null,
        })),
      ),
    ).rejects.toBe(original);
    expect(cleanupLog).toHaveBeenCalledWith(
      "[veda-mail] Attachment import cleanup failed.",
    );
    cleanupLog.mockRestore();
  });
  it("cancels invalid metadata without waiting for provider cancellation", async () => {
    let cancelled = false;
    const providerBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
        return new Promise(() => undefined);
      },
    });
    const deps = dependencies(async () => ({
      body: providerBody,
      mimeType: "text/plain",
      name: "invalid.txt",
      size: -1,
    }));

    await expect(
      importReceivedAttachment(input("invalid-metadata"), deps),
    ).rejects.toMatchObject({ code: "provider_failure" });
    expect(cancelled).toBe(true);
    expect(deps.quarantine.reserve).not.toHaveBeenCalled();
  });

  it("settles busy and aborted shared-memory waiters without downloading", async () => {
    vi.useFakeTimers();
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: limit,
      maxWaiters: 1,
      waitTimeoutMs: 20,
    });
    const active = await budget.acquire(limit);
    const download = vi.fn(cleanDownload);
    const busy = importReceivedAttachment(
      input("memory-busy"),
      dependencies(download, budget),
    );
    const busyRejection = expect(busy).rejects.toMatchObject({
      code: "ATTACHMENT_IMPORT_BUSY",
    });
    await vi.advanceTimersByTimeAsync(20);
    await busyRejection;

    const abort = new AbortController();
    const aborted = importReceivedAttachment(
      input("memory-abort", abort.signal),
      dependencies(download, budget),
    );
    abort.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted" });
    expect(download).not.toHaveBeenCalled();

    active.release();
    vi.useRealTimers();
    await expect(
      importReceivedAttachment(
        input("memory-retry"),
        dependencies(download, budget),
      ),
    ).resolves.toMatchObject({ state: "clean" });
  });

  it("releases memory when download concurrency is exhausted", async () => {
    const subject = crypto.randomUUID();
    const held: AttachmentDownloadLease[] = [
      acquireAttachmentDownloadLease(subject),
      acquireAttachmentDownloadLease(subject),
      acquireAttachmentDownloadLease(subject),
    ];
    const budget = new AttachmentSendMemoryBudget({
      capacityBytes: limit,
      waitTimeoutMs: 20,
    });
    const deps = dependencies(cleanDownload, budget);
    try {
      await expect(
        importReceivedAttachment(input(subject), deps),
      ).rejects.toMatchObject({ code: "ATTACHMENT_DOWNLOAD_BUSY" });
      held.pop()?.release();
      await expect(
        importReceivedAttachment(input(subject), deps),
      ).resolves.toMatchObject({ state: "clean" });
    } finally {
      held.forEach((lease) => lease.release());
    }
  });
});
