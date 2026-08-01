import { createHash } from "node:crypto";
import { chmod, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanReceivedScanner,
  otherReceivedScope,
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

describe("received attachment scan fidelity", () => {
  it.each([12, null])(
    "stages, scans, hashes, and serves exact bytes for length %s",
    async (expectedBytes) => {
      const observed: Uint8Array[] = [];
      const fixture = await receivedScanFixture({
        scanner: cleanReceivedScanner(observed),
      });
      directories.push(fixture.directory);
      const plaintext = Buffer.from("hello world!");
      const handle = await fixture.spool.stage({
        body: webBody("hello ", "world!"),
        expectedBytes,
        scope: receivedScope,
      });

      expect(Buffer.concat(observed)).toEqual(plaintext);
      expect(handle.snapshot).toMatchObject({
        byteLength: plaintext.byteLength,
        sha256: createHash("sha256").update(plaintext).digest("hex"),
        state: "clean",
      });
      const files = await readdir(fixture.directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[A-Za-z0-9_-]{32}\.vrs$/);
      const disk = await readFile(path.join(fixture.directory, files[0] ?? ""));
      expect(disk.includes(plaintext)).toBe(false);
      expect(disk.includes(Buffer.from(receivedScope.messageId))).toBe(false);
      expect(
        (await stat(path.join(fixture.directory, files[0] ?? ""))).mode & 0o777,
      ).toBe(0o600);
      await expect(
        handle.serve(otherReceivedScope),
      ).rejects.toMatchObject({ code: "scope_mismatch", status: 404 });
      await expect(
        readWebBody(await handle.serve(receivedScope)),
      ).resolves.toEqual(plaintext);
      expect(handle.snapshot.state).toBe("consumed");
      await expect(readdir(fixture.directory)).resolves.toEqual([]);
    },
  );

  it("supports empty unknown-length attachments", async () => {
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const handle = await fixture.spool.stage({
      body: webBody(),
      expectedBytes: null,
      scope: receivedScope,
    });

    await expect(
      readWebBody(await handle.serve(receivedScope)),
    ).resolves.toEqual(Buffer.alloc(0));
  });
});
