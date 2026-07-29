import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import {
  attachmentScope,
  body,
  cleanScanner,
  quarantineFixture,
  reserveText,
} from "./attachment-quarantine.fixture";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-attachment-attack-"));
});

afterEach(async () => {
  await chmod(directory, 0o700).catch(() => undefined);
  await rm(directory, { force: true, recursive: true });
});

describe("attachment quarantine adversarial behavior", () => {
  it("validates declared length before reading and permits a safe retry", async () => {
    const quarantine = quarantineFixture(directory);
    const reserved = await reserveText(quarantine, 3);
    let iterations = 0;
    const tracked: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        iterations += 1;
        yield Buffer.from("abc");
      },
    };
    await expect(
      quarantine.upload(reserved.id, attachmentScope, tracked, 2),
    ).rejects.toMatchObject({ code: "ATTACHMENT_LENGTH_MISMATCH" });
    expect(iterations).toBe(0);
    await expect(
      quarantine.upload(reserved.id, attachmentScope, tracked, 3),
    ).resolves.toMatchObject({ state: "clean" });
    expect(iterations).toBe(1);
  });
  it.each([
    ["short", 3, body("ab")],
    ["long", 2, body("abc")],
    [
      "non-byte",
      1,
      {
        async *[Symbol.asyncIterator]() {
          yield "x" as unknown as Uint8Array;
        },
      },
    ],
  ])(
    "rejects a %s streamed body and removes temporary files",
    async (_case, expected, streamedBody) => {
      const quarantine = quarantineFixture(directory);
      const reserved = await reserveText(quarantine, expected);
      await expect(
        quarantine.upload(reserved.id, attachmentScope, streamedBody, expected),
      ).rejects.toMatchObject({ status: expect.any(Number) });
      expect(
        (await quarantine.inspect(reserved.id, attachmentScope)).state,
      ).toBe("rejected");
      await expect(readdir(directory)).resolves.toEqual([]);
    },
  );
  it.each([
    {
      code: "ATTACHMENT_SCAN_UNAVAILABLE",
      scanner: {
        async scan(content) {
          for await (const _chunk of content) {
            void _chunk;
          }
          throw new Error("scanner offline");
        },
      } satisfies AttachmentScanner,
    },
    {
      code: "ATTACHMENT_SCAN_INCOMPLETE",
      scanner: {
        async scan() {
          return { verdict: "clean" };
        },
      } satisfies AttachmentScanner,
    },
    {
      code: "ATTACHMENT_REJECTED",
      scanner: {
        async scan(content) {
          for await (const _chunk of content) {
            void _chunk;
          }
          return { verdict: "infected" };
        },
      } satisfies AttachmentScanner,
    },
  ])("fails closed for scanner outcome $code", async ({ code, scanner }) => {
    const quarantine = quarantineFixture(directory, { scanner });
    const reserved = await reserveText(quarantine, 4);
    await expect(
      quarantine.upload(reserved.id, attachmentScope, body("evil"), 4),
    ).rejects.toMatchObject({ code });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
  it.each([
    {
      code: "ATTACHMENT_MIME_UNAVAILABLE",
      detector: {
        async detect() {
          throw new Error("detector offline");
        },
      } satisfies AttachmentMimeDetector,
    },
    {
      code: "ATTACHMENT_TYPE_REJECTED",
      detector: {
        async detect() {
          return { verdict: "rejected" };
        },
      } satisfies AttachmentMimeDetector,
    },
    {
      code: "ATTACHMENT_TYPE_REJECTED",
      detector: {
        async detect() {
          return { mimeType: "INVALID", verdict: "accepted" };
        },
      } satisfies AttachmentMimeDetector,
    },
  ])("fails closed for MIME outcome $code", async ({ code, detector }) => {
    const quarantine = quarantineFixture(directory, {
      mimeDetector: detector,
    });
    const reserved = await reserveText(quarantine, 4);
    await expect(
      quarantine.upload(reserved.id, attachmentScope, body("data"), 4),
    ).rejects.toMatchObject({ code });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
  it("expires stored ciphertext and removes its opaque record", async () => {
    let now = 1_000;
    const quarantine = quarantineFixture(directory, {
      now: () => now,
      ttlMs: 10,
    });
    const reserved = await reserveText(quarantine, 1);
    await quarantine.upload(reserved.id, attachmentScope, body("x"), 1);
    now += 11;
    await expect(quarantine.cleanupExpired()).resolves.toBe(1);
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("retains quota tracking and retries an expired ciphertext deletion", async () => {
    let now = 1_000;
    const quarantine = quarantineFixture(directory, {
      now: () => now,
      quotas: { maxFilesPerDraft: 1, maxGlobalRecords: 1 },
      ttlMs: 10,
    });
    const reserved = await reserveText(quarantine, 1);
    await quarantine.upload(reserved.id, attachmentScope, body("x"), 1);
    now += 11;
    await chmod(directory, 0o500);

    await expect(quarantine.cleanupExpired()).rejects.toMatchObject({
      code: "EACCES",
    });

    await chmod(directory, 0o700);
    now = 1_000;
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).resolves.toMatchObject({ state: "clean" });
    await expect(reserveText(quarantine, 1)).rejects.toMatchObject({
      code: "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED",
    });

    now += 11;
    await expect(quarantine.cleanupExpired()).resolves.toBe(1);
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(
      quarantine.inspect(reserved.id, attachmentScope),
    ).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
  });

  it("aborts an upload that expires during MIME quarantine", async () => {
    let now = 2_000;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const detector: AttachmentMimeDetector = {
      async detect() {
        entered.resolve();
        await release.promise;
        return { mimeType: "text/plain", verdict: "accepted" };
      },
    };
    const quarantine = quarantineFixture(directory, {
      mimeDetector: detector,
      now: () => now,
      scanner: cleanScanner(),
      ttlMs: 10,
    });
    const reserved = await reserveText(quarantine, 1);
    const upload = quarantine.upload(
      reserved.id,
      attachmentScope,
      body("x"),
      1,
    );
    await entered.promise;
    now += 11;
    await expect(quarantine.cleanupExpired()).resolves.toBe(1);
    release.resolve();

    await expect(upload).rejects.toMatchObject({ code: "ATTACHMENT_EXPIRED" });
    await expect(readdir(directory)).resolves.toEqual([]);
  });
});
