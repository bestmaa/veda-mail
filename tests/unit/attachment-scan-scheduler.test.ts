import { describe, expect, it, vi } from "vitest";

import type {
  AttachmentScanContext,
  AttachmentScanner,
} from "@/server/attachments";
import {
  AttachmentScanScheduler,
  scheduleAttachmentScanner,
} from "@/server/security/attachment-scan-scheduler";

const deferred = () => {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

const emptyContent = async function* () {
  yield new Uint8Array();
};

const scanContext = (
  attachmentId: string,
  signal = new AbortController().signal,
): AttachmentScanContext => ({
  abortUpload: vi.fn(),
  attachmentId,
  expectedBytes: 0,
  signal,
});

const scannerWithGates = (
  started: string[],
  gates: Map<string, ReturnType<typeof deferred>>,
): AttachmentScanner => ({
  async scan(_content, context) {
    started.push(context.attachmentId);
    await gates.get(context.attachmentId)?.promise;
    return { verdict: "clean" };
  },
});

describe("attachment scan scheduler", () => {
  it("runs queued scans in FIFO order within the active bound", async () => {
    const started: string[] = [];
    const gates = new Map([
      ["a", deferred()],
      ["b", deferred()],
      ["c", deferred()],
    ]);
    const scanner = scheduleAttachmentScanner(
      scannerWithGates(started, gates),
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 2,
        waitTimeoutMs: 1_000,
      }),
    );

    const scans = ["a", "b", "c"].map((id) =>
      scanner.scan(emptyContent(), scanContext(id)),
    );
    await vi.waitFor(() => expect(started).toEqual(["a"]));
    gates.get("a")?.resolve();
    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    gates.get("b")?.resolve();
    await vi.waitFor(() => expect(started).toEqual(["a", "b", "c"]));
    gates.get("c")?.resolve();
    await expect(Promise.all(scans)).resolves.toHaveLength(3);
  });

  it("rejects excess waiters without starting their scanner", async () => {
    const started: string[] = [];
    const gates = new Map([
      ["active", deferred()],
      ["waiting", deferred()],
    ]);
    const scanner = scheduleAttachmentScanner(
      scannerWithGates(started, gates),
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 1,
        waitTimeoutMs: 1_000,
      }),
    );
    const active = scanner.scan(emptyContent(), scanContext("active"));
    await vi.waitFor(() => expect(started).toEqual(["active"]));
    const waiting = scanner.scan(emptyContent(), scanContext("waiting"));

    await expect(
      scanner.scan(emptyContent(), scanContext("excess")),
    ).rejects.toMatchObject({ code: "ATTACHMENT_SCANNER_BUSY", status: 503 });
    expect(started).toEqual(["active"]);
    gates.get("active")?.resolve();
    gates.get("waiting")?.resolve();
    await expect(Promise.all([active, waiting])).resolves.toHaveLength(2);
  });

  it("removes an aborted waiter and admits the next request", async () => {
    const started: string[] = [];
    const gates = new Map([
      ["active", deferred()],
      ["next", deferred()],
    ]);
    const scanner = scheduleAttachmentScanner(
      scannerWithGates(started, gates),
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 1,
        waitTimeoutMs: 1_000,
      }),
    );
    const active = scanner.scan(emptyContent(), scanContext("active"));
    await vi.waitFor(() => expect(started).toEqual(["active"]));
    const controller = new AbortController();
    const aborted = scanner.scan(
      emptyContent(),
      scanContext("aborted", controller.signal),
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({
      code: "ATTACHMENT_SCAN_ABORTED",
    });
    const next = scanner.scan(emptyContent(), scanContext("next"));
    gates.get("active")?.resolve();
    await vi.waitFor(() => expect(started).toEqual(["active", "next"]));
    gates.get("next")?.resolve();
    await expect(Promise.all([active, next])).resolves.toHaveLength(2);
  });

  it("bounds queue wait time and frees waiter capacity", async () => {
    const gate = deferred();
    const scanner = scheduleAttachmentScanner(
      {
        async scan() {
          await gate.promise;
          return { verdict: "clean" };
        },
      },
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 1,
        waitTimeoutMs: 20,
      }),
    );
    const active = scanner.scan(emptyContent(), scanContext("active"));
    await expect(
      scanner.scan(emptyContent(), scanContext("timeout")),
    ).rejects.toMatchObject({ code: "ATTACHMENT_SCANNER_BUSY" });
    const replacement = scanner.scan(
      emptyContent(),
      scanContext("replacement"),
    );
    gate.resolve();
    await expect(Promise.all([active, replacement])).resolves.toHaveLength(2);
  });

  it("releases its permit when an active scan rejects", async () => {
    const firstGate = deferred();
    let calls = 0;
    const scanner = scheduleAttachmentScanner(
      {
        async scan() {
          calls += 1;
          if (calls === 1) await firstGate.promise;
          return { verdict: "clean" };
        },
      },
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 1,
        waitTimeoutMs: 1_000,
      }),
    );
    const failed = scanner.scan(emptyContent(), scanContext("failed"));
    const next = scanner.scan(emptyContent(), scanContext("next"));
    firstGate.reject(new Error("internal detail"));
    await expect(failed).rejects.toThrow("internal detail");
    await expect(next).resolves.toEqual({ verdict: "clean" });
    expect(calls).toBe(2);
  });

  it("releases an active permit after delegated abort handling", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const scanner = scheduleAttachmentScanner(
      {
        async scan(_content, scan) {
          started.push(scan.attachmentId);
          if (scan.attachmentId === "active") {
            await new Promise<void>((_resolve, reject) => {
              scan.signal.addEventListener(
                "abort",
                () => reject(new Error("scan cancelled")),
                { once: true },
              );
            });
          }
          return { verdict: "clean" };
        },
      },
      new AttachmentScanScheduler({
        maxActive: 1,
        maxWaiters: 1,
        waitTimeoutMs: 1_000,
      }),
    );
    const active = scanner.scan(
      emptyContent(),
      scanContext("active", controller.signal),
    );
    await vi.waitFor(() => expect(started).toEqual(["active"]));
    const next = scanner.scan(emptyContent(), scanContext("next"));
    controller.abort();

    await expect(active).rejects.toThrow("cancelled");
    await expect(next).resolves.toEqual({ verdict: "clean" });
    expect(started).toEqual(["active", "next"]);
  });
});
