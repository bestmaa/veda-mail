import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  createAttachmentQuarantine,
  type AttachmentQuarantineOptions,
  type AttachmentScanner,
  type AttachmentScope,
} from "@/server/attachments";
import {
  importReceivedAttachment,
  type AttachmentImportDependencies,
} from "@/server/mail/attachment-import";
import { AttachmentSendMemoryBudget } from "@/server/mail/attachment-send-memory-budget";
import { MagicNumberMimeDetector } from "@/server/security/attachment-inspection";

let directory = "";
const maximumBytes = 1_024;
const scope: AttachmentScope = {
  connectionId: "forward-connection",
  draftId: "forward-draft",
  ownerId: "member@example.com",
  sessionId: "forward-session",
};
const cleanScanner: AttachmentScanner = {
  async scan(content) {
    for await (const _chunk of content) void _chunk;
    return { verdict: "clean" };
  },
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-import-service-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

const body = (
  chunks: readonly Uint8Array[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> => {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    ...(onCancel ? { cancel: onCancel } : {}),
    pull(controller: ReadableStreamDefaultController<Uint8Array>) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(Uint8Array.from(chunk));
      else controller.close();
    },
  }, { highWaterMark: 0 });
};

const quarantine = (
  overrides: Partial<AttachmentQuarantineOptions> = {},
) =>
  createAttachmentQuarantine({
    directory,
    encryptionKey: Buffer.alloc(32, 19),
    mimeDetector: new MagicNumberMimeDetector(),
    scanner: cleanScanner,
    ...overrides,
  });

const input = (subject = crypto.randomUUID()) => ({
  attachmentId: id.attachment("opaque-attachment"),
  messageId: id.message("opaque-message"),
  scope,
  subject,
});

const dependencies = (
  service: ReturnType<typeof quarantine>,
  download: AttachmentImportDependencies["download"],
  maxBytes = maximumBytes,
): AttachmentImportDependencies => ({
  download,
  maximumBytes: maxBytes,
  memoryBudget: new AttachmentSendMemoryBudget({
    capacityBytes: maxBytes,
    waitTimeoutMs: 100,
  }),
  quarantine: service,
});

describe("received attachment quarantine import", () => {
  it("imports once, sanitizes metadata, rescans, and preserves clean bytes", async () => {
    const service = quarantine();
    const content = Buffer.from("provider attachment");
    const download = vi.fn(async () => ({
      body: body([content.subarray(0, 4), content.subarray(4)]),
      mimeType: "TEXT/PLAIN; charset=UTF-8",
      name: "../notes\r\nfinal.txt",
      size: null,
    }));

    const imported = await importReceivedAttachment(
      input(),
      dependencies(service, download),
    );

    expect(download).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "opaque-attachment",
        maxBytes: maximumBytes,
        messageId: "opaque-message",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(imported).toMatchObject({
      contentLength: content.byteLength,
      detectedMimeType: "text/plain",
      state: "clean",
    });
    expect(imported.fileName).not.toMatch(/[\\/\r\n]/u);

    await service.claim([imported.id], scope);
    await expect(service.readClaimed(imported.id, scope)).resolves.toEqual(
      content,
    );
    await service.release([imported.id], scope);
    await service.remove(imported.id, scope);
  });

  it("lets magic-number detection override an untrusted MIME hint", async () => {
    const service = quarantine();
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n");

    const imported = await importReceivedAttachment(
      input(),
      dependencies(service, async () => ({
        body: body([pdf]),
        mimeType: "text/plain",
        name: "document.txt",
        size: pdf.byteLength,
      })),
    );

    expect(imported.detectedMimeType).toBe("application/pdf");
    await service.remove(imported.id, scope);
  });

  it("caps declared and actual decoded bytes and cancels provider streams", async () => {
    const service = quarantine();
    let declaredCancelled = false;
    const declared = importReceivedAttachment(
      input(),
      dependencies(
        service,
        async () => ({
          body: new ReadableStream<Uint8Array>({
            cancel() {
              declaredCancelled = true;
            },
            pull() {},
          }),
          mimeType: "application/octet-stream",
          name: "large.bin",
          size: 5,
        }),
        4,
      ),
    );
    await expect(declared).rejects.toMatchObject({
      code: "size_limit_exceeded",
    });
    await vi.waitFor(() => expect(declaredCancelled).toBe(true));

    let actualCancelled = false;
    const actual = importReceivedAttachment(
      input(),
      dependencies(
        service,
        async () => ({
          body: body([new Uint8Array(5)], () => {
            actualCancelled = true;
          }),
          mimeType: "application/octet-stream",
          name: "large.bin",
          size: null,
        }),
        4,
      ),
    );
    await expect(actual).rejects.toMatchObject({
      code: "size_limit_exceeded",
    });
    await vi.waitFor(() => expect(actualCancelled).toBe(true));
  });

  it.each([
    ["zero-byte", [], 0],
    ["truncated", [new Uint8Array(2)], 3],
  ] as const)("rejects a %s provider result before reserving", async (
    _case,
    chunks,
    declaredSize,
  ) => {
    const service = quarantine();

    await expect(
      importReceivedAttachment(
        input(),
        dependencies(service, async () => ({
          body: body(chunks),
          mimeType: "text/plain",
          name: "invalid.txt",
          size: declaredSize,
        })),
      ),
    ).rejects.toMatchObject({ code: "provider_failure" });
  });

  it("releases all leases when draft quota rejects the exact observed size", async () => {
    const service = quarantine({
      directory,
      mimeDetector: new MagicNumberMimeDetector(),
      quotas: { maxFilesPerDraft: 1 },
      scanner: cleanScanner,
    });
    const existing = await service.reserve({
      contentLength: 1,
      declaredMimeType: "text/plain",
      fileName: "existing.txt",
      scope,
    });
    const download = vi.fn(async () => ({
      body: body([new Uint8Array([1])]),
      mimeType: "application/octet-stream",
      name: "next.bin",
      size: 1,
    }));
    const deps = dependencies(service, download);

    await expect(
      importReceivedAttachment(input("quota-subject"), deps),
    ).rejects.toMatchObject({ code: "ATTACHMENT_COUNT_QUOTA_EXCEEDED" });
    await service.remove(existing.id, scope);

    const retry = await importReceivedAttachment(input("quota-subject"), deps);
    expect(retry.state).toBe("clean");
    await service.remove(retry.id, scope);
  });
});
