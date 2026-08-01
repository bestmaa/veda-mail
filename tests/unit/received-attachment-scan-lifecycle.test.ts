import {
  chmod,
  mkdir,
  readdir,
  rm,
  utimes,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupReceivedAttachmentScanOrphans,
  createReceivedAttachmentScanDirectory,
} from "@/server/mail/received-attachment-scan";
import {
  readWebBody,
  receivedScanFixture,
  receivedScope,
  webBody,
} from "./received-attachment-scan.fixture";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (directory) => {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }));
});

describe("received attachment scan lifecycle", () => {
  it("consumes on stream cancel and disposes idempotently", async () => {
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const payload = Buffer.alloc(70 * 1024, 11);
    const cancelled = await fixture.spool.stage({
      body: webBody(payload),
      expectedBytes: payload.byteLength,
      scope: receivedScope,
    });
    const reader = (await cancelled.serve(receivedScope)).getReader();
    expect((await reader.read()).value).toHaveLength(64 * 1024);
    await reader.cancel();
    expect(cancelled.snapshot.state).toBe("consumed");
    await cancelled.dispose();
    await cancelled.dispose();

    const disposed = await fixture.spool.stage({
      body: webBody("dispose"),
      expectedBytes: 7,
      scope: receivedScope,
    });
    await Promise.all([
      disposed.dispose(),
      disposed.dispose(),
      fixture.spool.dispose(),
    ]);
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
    await expect(disposed.serve(receivedScope)).rejects.toMatchObject({
      code: "state_conflict",
    });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("enforces global byte and record reservations", async () => {
    const fixture = await receivedScanFixture({
      maxBytes: 10,
      maxGlobalBytes: 10,
      maxGlobalRecords: 1,
    });
    directories.push(fixture.directory);
    const first = await fixture.spool.stage({
      body: webBody("abc"),
      expectedBytes: null,
      scope: receivedScope,
    });
    expect(fixture.spool.stats()).toEqual({ bytes: 3, records: 1 });
    await expect(fixture.spool.stage({
      body: webBody("x"),
      expectedBytes: 1,
      scope: { ...receivedScope, attachmentId: "another" },
    })).rejects.toMatchObject({ code: "quota_exceeded" });
    await first.dispose();
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
  });

  it("reserves the full file ceiling until a declared stream is verified", async () => {
    let releaseScan = (): void => undefined;
    let markConsumed = (): void => undefined;
    const released = new Promise<void>((resolve) => { releaseScan = resolve; });
    const consumed = new Promise<void>((resolve) => { markConsumed = resolve; });
    const fixture = await receivedScanFixture({
      maxBytes: 10,
      maxGlobalBytes: 10,
      maxGlobalRecords: 2,
      scanner: {
        async scan(content) {
          for await (const chunk of content) void chunk;
          markConsumed();
          await released;
          return { verdict: "clean" };
        },
      },
    });
    directories.push(fixture.directory);
    const pending = fixture.spool.stage({
      body: webBody("x"),
      expectedBytes: 1,
      scope: receivedScope,
    });
    await consumed;
    expect(fixture.spool.stats()).toEqual({ bytes: 10, records: 1 });
    await expect(fixture.spool.stage({
      body: webBody("y"),
      expectedBytes: 1,
      scope: { ...receivedScope, attachmentId: "dishonest-second" },
    })).rejects.toMatchObject({ code: "quota_exceeded" });
    releaseScan();
    const handle = await pending;
    expect(fixture.spool.stats()).toEqual({ bytes: 1, records: 1 });
    await handle.dispose();
  });

  it("retains quota accounting until a failed ciphertext delete retries", async () => {
    const fixture = await receivedScanFixture({ maxBytes: 10 });
    directories.push(fixture.directory);
    const handle = await fixture.spool.stage({
      body: webBody("secret"),
      expectedBytes: 6,
      scope: receivedScope,
    });
    await chmod(fixture.directory, 0o500);
    await handle.dispose();
    expect(fixture.spool.stats()).toEqual({ bytes: 6, records: 1 });
    await chmod(fixture.directory, 0o700);
    await expect(fixture.spool.cleanupExpired()).resolves.toBe(1);
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("expires clean records and cleans their ciphertext", async () => {
    let now = 1_000;
    const states: string[] = [];
    const fixture = await receivedScanFixture({
      now: () => now,
      onStateChange: (state) => states.push(state),
      ttlMs: 50,
    });
    directories.push(fixture.directory);
    const handle = await fixture.spool.stage({
      body: webBody("ttl"),
      expectedBytes: 3,
      scope: receivedScope,
    });
    now += 51;
    await expect(fixture.spool.cleanupExpired()).resolves.toBe(1);
    expect(handle.snapshot.state).toBe("expired");
    expect(states).toEqual(["staging", "scanning", "clean", "expired"]);
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("removes only aged process spool directories", async () => {
    const stableRoot = path.join(os.tmpdir(), `veda-orphans-stable-${Date.now()}`);
    await mkdir(stableRoot);
    directories.push(stableRoot);
    const oldDirectory = path.join(
      stableRoot,
      "veda-mail-received-scan-2147483647-stale",
    );
    await mkdir(oldDirectory);
    const freshDirectory = await createReceivedAttachmentScanDirectory(stableRoot);
    const unrelated = path.join(stableRoot, "unrelated");
    await mkdir(unrelated);
    const old = new Date(Date.now() - 60_000);
    await utimes(oldDirectory, old, old);

    await expect(cleanupReceivedAttachmentScanOrphans(stableRoot, {
      minimumAgeMs: 30_000,
    })).resolves.toBe(1);
    const remaining = await readdir(stableRoot);
    expect(remaining).toContain(path.basename(freshDirectory));
    expect(remaining).toContain("unrelated");
    expect(remaining).not.toContain(path.basename(oldDirectory));
  });

  it("rejects a second serve after a completed read", async () => {
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const handle = await fixture.spool.stage({
      body: webBody("one shot"),
      expectedBytes: 8,
      scope: receivedScope,
    });
    await readWebBody(await handle.serve(receivedScope));
    await expect(
      handle.serve(receivedScope),
    ).rejects.toMatchObject({ code: "state_conflict" });
  });
});
