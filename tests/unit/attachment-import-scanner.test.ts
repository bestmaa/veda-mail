import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { id } from "@/domain/shared/brand";
import {
  AttachmentQuarantineError,
  createAttachmentQuarantine,
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
const limit = 64;
const scope: AttachmentScope = {
  connectionId: "scanner-connection",
  draftId: "scanner-draft",
  ownerId: "scanner@example.com",
  sessionId: "scanner-session",
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-import-scanner-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(directory, { force: true, recursive: true });
});

const source = (value = "forwarded bytes") =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(value));
      controller.close();
    },
  });

const quarantine = (scanner: AttachmentScanner) =>
  createAttachmentQuarantine({
    directory,
    encryptionKey: Buffer.alloc(32, 27),
    mimeDetector: new MagicNumberMimeDetector(),
    quotas: { maxFilesPerDraft: 1, maxGlobalRecords: 1 },
    scanner,
  });

const input = (signal?: AbortSignal) => ({
  attachmentId: id.attachment("opaque-scanner-attachment"),
  messageId: id.message("opaque-scanner-message"),
  scope,
  ...(signal ? { signal } : {}),
  subject: crypto.randomUUID(),
});

const dependencies = (
  service: ReturnType<typeof quarantine>,
  timeoutMs?: number,
): AttachmentImportDependencies => ({
  download: async () => ({
    body: source(),
    mimeType: "text/plain",
    name: "forwarded.txt",
    size: 15,
  }),
  maximumBytes: limit,
  memoryBudget: new AttachmentSendMemoryBudget({
    capacityBytes: limit,
    waitTimeoutMs: 100,
  }),
  quarantine: service,
  ...(timeoutMs ? { timeoutMs } : {}),
});

const cleanScanner: AttachmentScanner = {
  async scan(content) {
    for await (const _chunk of content) void _chunk;
    return { verdict: "clean" };
  },
};

const waitingScanner = (
  entered: ReturnType<typeof Promise.withResolvers<void>>,
): AttachmentScanner => ({
  async scan(content, context) {
    for await (const _chunk of content) void _chunk;
    entered.resolve();
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new Error("scanner interrupted"));
      context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) abort();
    });
  },
});

describe("attachment import scanner failure cleanup", () => {
  it("removes malware rejection so the same draft can retry", async () => {
    let infected = true;
    const scanner: AttachmentScanner = {
      async scan(content) {
        for await (const _chunk of content) void _chunk;
        return infected ? { verdict: "infected" } : { verdict: "clean" };
      },
    };
    const service = quarantine(scanner);
    const deps = dependencies(service);

    await expect(importReceivedAttachment(input(), deps)).rejects.toMatchObject(
      { code: "ATTACHMENT_REJECTED" },
    );
    await expect(readdir(directory)).resolves.toEqual([]);

    infected = false;
    const retry = await importReceivedAttachment(input(), deps);
    expect(retry.state).toBe("clean");
    await service.remove(retry.id, scope);
  });

  it("fails closed and cleans up when the scanner is unavailable", async () => {
    const service = quarantine({
      async scan(content) {
        for await (const _chunk of content) void _chunk;
        throw new Error("scanner endpoint unavailable");
      },
    });

    await expect(
      importReceivedAttachment(input(), dependencies(service)),
    ).rejects.toMatchObject({ code: "ATTACHMENT_SCAN_UNAVAILABLE" });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("aborts a pending scanner verdict and removes its reservation", async () => {
    const entered = Promise.withResolvers<void>();
    const abort = new AbortController();
    const service = quarantine(waitingScanner(entered));
    const pending = importReceivedAttachment(
      input(abort.signal),
      dependencies(service),
    );
    await entered.promise;

    abort.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("enforces the total import deadline during scanner verdict wait", async () => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const service = quarantine(waitingScanner(entered));
    const pending = importReceivedAttachment(
      input(),
      dependencies(service, 20),
    );
    await entered.promise;
    const rejection = expect(pending).rejects.toMatchObject({
      code: "timeout",
    });

    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("does not mask the original failure when cleanup removal fails", async () => {
    const original = new AttachmentQuarantineError(
      "Malware detected.",
      "ATTACHMENT_REJECTED",
      422,
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fakeQuarantine = {
      async remove() {
        throw new Error("private storage path");
      },
      async reserve() {
        return {
          contentLength: 15,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          fileName: "forwarded.txt",
          id: "a".repeat(32),
          state: "reserved" as const,
        };
      },
      async upload() {
        throw original;
      },
    };
    const deps = {
      ...dependencies(quarantine(cleanScanner)),
      quarantine: fakeQuarantine,
    };

    await expect(importReceivedAttachment(input(), deps)).rejects.toBe(
      original,
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[veda-mail] Attachment import cleanup failed.",
    );
    consoleError.mockRestore();
  });
});
