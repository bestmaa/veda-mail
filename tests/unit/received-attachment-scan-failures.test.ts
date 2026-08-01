import { chmod, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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

describe("received attachment scan failures", () => {
  it("rejects a scanner that reports clean before consuming the body", async () => {
    const fixture = await receivedScanFixture({
      scanner: { async scan() { return { verdict: "clean" }; } },
    });
    directories.push(fixture.directory);

    await expect(fixture.spool.stage({
      body: webBody("not scanned"),
      expectedBytes: null,
      scope: receivedScope,
    })).rejects.toMatchObject({ code: "scan_incomplete" });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it.each([
    {
      code: "infected",
      scanner: {
        async scan(content: AsyncIterable<Uint8Array>) {
          for await (const chunk of content) void chunk;
          return { verdict: "infected" as const };
        },
      },
    },
    {
      code: "scanner_unavailable",
      scanner: {
        async scan(content: AsyncIterable<Uint8Array>) {
          for await (const chunk of content) void chunk;
          throw new Error("private scanner detail");
        },
      },
    },
  ])("fails closed for $code", async ({ code, scanner }) => {
    const fixture = await receivedScanFixture({ scanner });
    directories.push(fixture.directory);
    await expect(fixture.spool.stage({
      body: webBody("payload"),
      expectedBytes: 7,
      scope: receivedScope,
    })).rejects.toMatchObject({ code });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("rejects oversized and dishonest provider lengths", async () => {
    const fixture = await receivedScanFixture({ maxBytes: 4 });
    directories.push(fixture.directory);
    await expect(fixture.spool.stage({
      body: webBody("12345"),
      expectedBytes: null,
      scope: receivedScope,
    })).rejects.toMatchObject({ code: "size_limit_exceeded" });
    await expect(fixture.spool.stage({
      body: webBody("123"),
      expectedBytes: 4,
      scope: receivedScope,
    })).rejects.toMatchObject({ code: "length_mismatch" });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("aborts immediately and times out stalled provider reads", async () => {
    const fixture = await receivedScanFixture({
      idleTimeoutMs: 20,
      operationTimeoutMs: 100,
    });
    directories.push(fixture.directory);
    const aborted = new AbortController();
    aborted.abort();
    await expect(fixture.spool.stage({
      body: webBody("secret"),
      expectedBytes: 6,
      scope: receivedScope,
      signal: aborted.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    await expect(fixture.spool.stage({
      body: new ReadableStream<Uint8Array>(),
      expectedBytes: null,
      scope: receivedScope,
    })).rejects.toMatchObject({ code: "timeout" });
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });

  it("tracks a failed temporary-file deletion until cleanup can retry", async () => {
    let directory = "";
    const fixture = await receivedScanFixture({
      maxBytes: 10,
      scanner: {
        async scan(content) {
          for await (const chunk of content) void chunk;
          await chmod(directory, 0o500);
          return { verdict: "infected" };
        },
      },
    });
    directory = fixture.directory;
    directories.push(directory);
    await expect(fixture.spool.stage({
      body: webBody("secret"),
      expectedBytes: 6,
      scope: receivedScope,
    })).rejects.toMatchObject({ code: "infected" });
    expect(fixture.spool.stats()).toEqual({ bytes: 10, records: 1 });
    await chmod(directory, 0o700);
    await fixture.spool.cleanupExpired();
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("authenticates ciphertext before exposing a corrupt chunk", async () => {
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const handle = await fixture.spool.stage({
      body: webBody("secret"),
      expectedBytes: 6,
      scope: receivedScope,
    });
    const fileName = (await readdir(fixture.directory))[0] ?? "";
    const encrypted = await readFile(path.join(fixture.directory, fileName));
    const last = encrypted.byteLength - 1;
    encrypted[last] = (encrypted[last] ?? 0) ^ 1;
    await writeFile(path.join(fixture.directory, fileName), encrypted);

    await expect(
      readWebBody(await handle.serve(receivedScope)),
    ).rejects.toMatchObject({ code: "corrupt" });
    expect(handle.snapshot.state).toBe("rejected");
    await expect(readdir(fixture.directory)).resolves.toEqual([]);
  });
});
