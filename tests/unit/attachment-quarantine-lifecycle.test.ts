import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  attachmentScope,
  body,
  cleanScanner,
  otherAttachmentScope,
  quarantineFixture,
  reserveText,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-attachment-life-"));
});

afterEach(async () => {
  await chmod(directory, 0o700).catch(() => undefined);
  await rm(directory, { force: true, recursive: true });
});

describe("attachment quarantine lifecycle", () => {
  it("encrypts, binds, claims, authenticates, releases, and consumes", async () => {
    const scanned: Uint8Array[] = [];
    const quarantine = quarantineFixture(directory, {
      scanner: cleanScanner(scanned),
    });
    const plaintext = "confidential attachment contents";
    const reserved = await reserveText(
      quarantine,
      Buffer.byteLength(plaintext),
      attachmentScope,
      "../confidential\u202etxt.exe",
    );
    const clean = await quarantine.upload(
      reserved.id,
      attachmentScope,
      body("confidential ", "attachment contents"),
      Buffer.byteLength(plaintext),
    );

    expect(Buffer.concat(scanned).toString()).toBe(plaintext);
    expect(clean).toMatchObject({
      detectedMimeType: "text/plain",
      fileName: "_confidential_txt.exe",
      state: "clean",
    });
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^attachment-[A-Za-z0-9_-]{32}\.vma$/);
    const encrypted = await readFile(path.join(directory, files[0] ?? ""));
    expect(encrypted.includes(Buffer.from(plaintext))).toBe(false);
    expect(encrypted.includes(Buffer.from(clean.fileName))).toBe(false);
    expect(
      (await stat(path.join(directory, files[0] ?? ""))).mode & 0o777,
    ).toBe(0o600);

    await expect(
      quarantine.inspect(reserved.id, otherAttachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND", status: 404 });
    expect(
      (await quarantine.claim([reserved.id], attachmentScope))[0]?.state,
    ).toBe("claimed");
    await expect(
      quarantine.readClaimed(reserved.id, otherAttachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    await expect(
      quarantine.readClaimed(reserved.id, attachmentScope),
    ).resolves.toEqual(Buffer.from(plaintext));
    expect(
      (await quarantine.release([reserved.id], attachmentScope))[0]?.state,
    ).toBe("clean");
    await quarantine.claim([reserved.id], attachmentScope);
    expect(
      (await quarantine.consume([reserved.id], attachmentScope))[0]?.state,
    ).toBe("consumed");
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects tampered ciphertext before returning any bytes", async () => {
    const quarantine = quarantineFixture(directory);
    const reserved = await reserveText(quarantine, 6);
    await quarantine.upload(reserved.id, attachmentScope, body("secret"), 6);
    await quarantine.claim([reserved.id], attachmentScope);
    const file = (await readdir(directory))[0];
    const encrypted = await readFile(path.join(directory, file ?? ""));
    const tamperIndex = Math.floor(encrypted.length / 2);
    encrypted[tamperIndex] = (encrypted[tamperIndex] ?? 0) ^ 1;
    await writeFile(path.join(directory, file ?? ""), encrypted);

    await expect(
      quarantine.readClaimed(reserved.id, attachmentScope),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_INTEGRITY_FAILED",
      status: 500,
    });
    expect((await quarantine.inspect(reserved.id, attachmentScope)).state).toBe(
      "rejected",
    );
    await expect(readdir(directory)).resolves.toEqual([]);
    await quarantine.remove(reserved.id, attachmentScope);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("claims a set atomically and rejects duplicate selections", async () => {
    const quarantine = quarantineFixture(directory);
    const first = await reserveText(quarantine, 1);
    const second = await reserveText(quarantine, 1);
    await quarantine.upload(first.id, attachmentScope, body("a"), 1);

    await expect(
      quarantine.claim([first.id, second.id], attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_STATE_CONFLICT" });
    expect((await quarantine.inspect(first.id, attachmentScope)).state).toBe(
      "clean",
    );
    await expect(
      quarantine.claim([first.id, first.id], attachmentScope),
    ).rejects.toMatchObject({ code: "INVALID_ATTACHMENT_SELECTION" });
  });

  it("permits only one concurrent uploader for a reservation", async () => {
    const quarantine = quarantineFixture(directory);
    const reserved = await reserveText(quarantine, 1);
    const results = await Promise.allSettled([
      quarantine.upload(reserved.id, attachmentScope, body("a"), 1),
      quarantine.upload(reserved.id, attachmentScope, body("b"), 1),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect((await quarantine.inspect(reserved.id, attachmentScope)).state).toBe(
      "clean",
    );
  });

  it("removes idempotently without revealing a mismatched binding", async () => {
    const quarantine = quarantineFixture(directory);
    const abandoned = await reserveText(quarantine, 1);
    await quarantine.remove(abandoned.id, attachmentScope);
    await expect(
      quarantine.inspect(abandoned.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    const reserved = await reserveText(quarantine, 1);
    await quarantine.upload(reserved.id, attachmentScope, body("x"), 1);

    await expect(
      quarantine.remove(reserved.id, otherAttachmentScope),
    ).resolves.toBeUndefined();
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).resolves.toMatchObject({ state: "clean" });
    await expect(
      quarantine.remove(reserved.id, attachmentScope),
    ).resolves.toBeUndefined();
    await expect(
      quarantine.remove(reserved.id, attachmentScope),
    ).resolves.toBeUndefined();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("aborts and cleans an in-flight upload when removed", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const quarantine = quarantineFixture(directory, {
      scanner: {
        async scan(content) {
          entered.resolve();
          await release.promise;
          for await (const chunk of content) void chunk;
          return { verdict: "clean" };
        },
      },
    });
    const reserved = await reserveText(quarantine, 1);
    const upload = quarantine.upload(
      reserved.id,
      attachmentScope,
      body("x"),
      1,
    );
    await entered.promise;
    await quarantine.remove(reserved.id, attachmentScope);
    release.resolve();

    await expect(upload).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_ABORTED",
    });
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("aborts a body that stops making progress and removes temp bytes", async () => {
    const quarantine = quarantineFixture(directory, {
      uploadIdleTimeoutMs: 25,
      uploadTimeoutMs: 200,
    });
    const reserved = await reserveText(quarantine, 1);
    const stalled = new ReadableStream<Uint8Array>();

    await expect(
      quarantine.upload(reserved.id, attachmentScope, stalled, 1),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_UPLOAD_TIMEOUT",
      status: 408,
    });
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("allows a slow upload while every chunk meets the idle deadline", async () => {
    const quarantine = quarantineFixture(directory, {
      uploadIdleTimeoutMs: 30,
      uploadTimeoutMs: 250,
    });
    const reserved = await reserveText(quarantine, 3);
    const slowBody = {
      async *[Symbol.asyncIterator]() {
        for (const chunk of ["a", "b", "c"]) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          yield Buffer.from(chunk);
        }
      },
    };

    await expect(
      quarantine.upload(reserved.id, attachmentScope, slowBody, 3),
    ).resolves.toMatchObject({ state: "clean" });
  });
});
