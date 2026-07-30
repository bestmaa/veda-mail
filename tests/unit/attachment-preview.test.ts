import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { id } from "@/domain/shared/brand";
import { acquireAttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import {
  prepareTextAttachmentPreview,
  type AttachmentPreviewDependencies,
} from "@/server/mail/attachment-preview";
import { createAttachmentPreviewResponse } from "@/server/mail/attachment-preview-http";

const body = (value: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });

const detector: AttachmentMimeDetector = {
  async detect() {
    return { mimeType: "text/plain", verdict: "accepted" };
  },
};

const scanner: AttachmentScanner = {
  async scan(content) {
    for await (const _chunk of content) void _chunk;
    return { verdict: "clean" };
  },
};

const dependencies = (
  value = "safe\r\ntext",
): AttachmentPreviewDependencies => ({
  download: vi.fn(async () => ({
    body: body(value),
    mimeType: "text/plain",
    name: "notes.txt",
    size: new TextEncoder().encode(value).byteLength,
  })),
  mimeDetector: detector,
  scanner,
});

const input = (subject = crypto.randomUUID(), signal?: AbortSignal) => ({
  attachmentId: id.attachment("opaque-preview-attachment"),
  messageId: id.message("opaque-preview-message"),
  ...(signal ? { signal } : {}),
  subject,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachment preview preparation", () => {
  it("uses opaque provider inputs, returns normalized text, and wipes on dispose", async () => {
    const deps = dependencies();
    const prepared = await prepareTextAttachmentPreview(input(), deps);

    expect(new TextDecoder().decode(prepared.bytes)).toBe("safe\ntext");
    expect(deps.download).toHaveBeenCalledWith({
      attachmentId: "opaque-preview-attachment",
      maxBytes: 1_048_576,
      messageId: "opaque-preview-message",
      signal: expect.any(AbortSignal),
    });
    prepared.dispose();
    expect(prepared.bytes.every((value) => value === 0)).toBe(true);
    prepared.dispose();
  });

  it("participates in the shared provider download budget", async () => {
    const subject = crypto.randomUUID();
    const held = [
      acquireAttachmentDownloadLease(subject),
      acquireAttachmentDownloadLease(subject),
      acquireAttachmentDownloadLease(subject),
    ];
    const deps = dependencies();
    await expect(
      prepareTextAttachmentPreview(input(subject), deps),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_DOWNLOAD_BUSY",
      status: 429,
    });
    expect(deps.download).not.toHaveBeenCalled();
    held.forEach((lease) => lease.release());

    const retry = await prepareTextAttachmentPreview(input(subject), deps);
    retry.dispose();
  });

  it("keeps an oversized preview distinct from the valid download action", async () => {
    const deps: AttachmentPreviewDependencies = {
      ...dependencies(),
      download: vi.fn(async () => ({
        body: body("safe"),
        mimeType: "text/plain",
        name: "large-notes.txt",
        size: 1_048_577,
      })),
    };

    await expect(
      prepareTextAttachmentPreview(input(), deps),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_TOO_LARGE",
      message:
        "This attachment is too large to preview. You can still download it.",
      status: 413,
    });
  });

  it("releases every lease after a scanner failure so retry succeeds", async () => {
    const subject = crypto.randomUUID();
    const deps = {
      ...dependencies(),
      scanner: {
        async scan(content: AsyncIterable<Uint8Array>) {
          for await (const _chunk of content) void _chunk;
          throw new Error("private scanner address");
        },
      },
    };

    await expect(
      prepareTextAttachmentPreview(input(subject), deps),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_SCANNER_UNAVAILABLE",
      status: 503,
    });

    const retry = await prepareTextAttachmentPreview(
      input(subject),
      dependencies(),
    );
    retry.dispose();
  });

  it("times out a scanner that ignores abort and releases its lease", async () => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const subject = crypto.randomUUID();
    const deps: AttachmentPreviewDependencies = {
      ...dependencies(),
      scanner: {
        async scan() {
          entered.resolve();
          return new Promise(() => undefined);
        },
      },
      timeoutMs: 20,
    };
    const pending = prepareTextAttachmentPreview(input(subject), deps);
    await entered.promise;
    const rejection = expect(pending).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_TIMEOUT",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    const retry = await prepareTextAttachmentPreview(
      input(subject),
      dependencies(),
    );
    retry.dispose();
  });

  it("times out a MIME detector that ignores abort and releases its lease", async () => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const subject = crypto.randomUUID();
    const deps: AttachmentPreviewDependencies = {
      ...dependencies(),
      mimeDetector: {
        async detect() {
          entered.resolve();
          return new Promise(() => undefined);
        },
      },
      timeoutMs: 20,
    };
    const pending = prepareTextAttachmentPreview(input(subject), deps);
    await entered.promise;
    const rejection = expect(pending).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_TIMEOUT",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    const retry = await prepareTextAttachmentPreview(
      input(subject),
      dependencies(),
    );
    retry.dispose();
  });

  it("releases stalled response slots at the delivery deadline", async () => {
    vi.useFakeTimers();
    const first = await prepareTextAttachmentPreview(
      input(crypto.randomUUID()),
      dependencies(),
    );
    const second = await prepareTextAttachmentPreview(
      input(crypto.randomUUID()),
      dependencies(),
    );
    const firstResponse = createAttachmentPreviewResponse(
      first,
      undefined,
      20,
    );
    const secondResponse = createAttachmentPreviewResponse(
      second,
      undefined,
      20,
    );

    await expect(
      prepareTextAttachmentPreview(input(crypto.randomUUID()), dependencies()),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_BUSY",
      status: 429,
    });
    await vi.advanceTimersByTimeAsync(20);
    await expect(firstResponse.text()).rejects.toBeDefined();
    await expect(secondResponse.text()).rejects.toBeDefined();

    const retry = await prepareTextAttachmentPreview(
      input(crypto.randomUUID()),
      dependencies(),
    );
    retry.dispose();
  });
});
