import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createSharedAttachmentQuarantine,
  type AttachmentMimeDetector,
  type AttachmentScanner,
  type AttachmentScope,
} from "@/server/attachments";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:attachment:${crypto.randomUUID()}`;
const key = Buffer.alloc(32, 47);
const scope: AttachmentScope = {
  connectionId: "private-connection",
  draftId: "private-draft",
  ownerId: "private-owner@example.com",
  sessionId: "private-session",
};
const scanner: AttachmentScanner = {
  async scan(content) {
    for await (const chunk of content) void chunk;
    return { verdict: "clean" };
  },
};
const detector: AttachmentMimeDetector = {
  async detect() {
    return { mimeType: "text/plain", verdict: "accepted" };
  },
};
const body = (value: string): AsyncIterable<Uint8Array> => ({
  async *[Symbol.asyncIterator]() { yield Buffer.from(value); },
});

describe.skipIf(!redisUrl)("live shared attachment quarantine", () => {
  const inspector = createClient({ url: redisUrl! });
  let firstDirectory = "";
  let secondDirectory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
    firstDirectory = await mkdtemp(path.join(tmpdir(), "veda-shared-a-"));
    secondDirectory = await mkdtemp(path.join(tmpdir(), "veda-shared-b-"));
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await Promise.all([
      rm(firstDirectory, { force: true, recursive: true }),
      rm(secondDirectory, { force: true, recursive: true }),
    ]);
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("moves encrypted bytes through two replica instances", async () => {
    const first = createSharedAttachmentQuarantine({
      directory: firstDirectory, encryptionKey: key,
      mimeDetector: detector, scanner,
    });
    const second = createSharedAttachmentQuarantine({
      directory: secondDirectory, encryptionKey: key,
      mimeDetector: detector, scanner,
    });
    const plaintext = `shared-secret-${crypto.randomUUID()}`;
    const reserved = await first.reserve({
      contentLength: Buffer.byteLength(plaintext),
      declaredMimeType: "text/plain",
      fileName: "private-notes.txt",
      scope,
    });
    await first.upload(
      reserved.id, scope, body(plaintext), Buffer.byteLength(plaintext),
    );
    const storedKeys = await inspector.keys(`${prefix}:*`);
    const storedValues = await inspector.mGet(storedKeys);
    const storedSurface = JSON.stringify({ storedKeys, storedValues });
    expect(storedSurface).not.toContain(plaintext);
    expect(storedSurface).not.toContain("private-notes.txt");
    expect(storedSurface).not.toContain("private-owner@example.com");
    resetSharedStateRedisClientForTests();
    await expect(second.inspect(reserved.id, scope))
      .resolves.toMatchObject({ state: "clean" });
    await second.claim([reserved.id], scope);
    await expect(second.readClaimed(reserved.id, scope))
      .resolves.toEqual(Buffer.from(plaintext));
    await second.release([reserved.id], scope);
    await first.claim([reserved.id], scope);
    await second.consume([reserved.id], scope);
    await expect(first.inspect(reserved.id, scope))
      .rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });

    expect(await inspector.keys(`${prefix}:*`)).toEqual([]);
  });

  it("fails closed when a ciphertext chunk is modified", async () => {
    const quarantine = createSharedAttachmentQuarantine({
      directory: firstDirectory, encryptionKey: key,
      mimeDetector: detector, scanner,
    });
    const plaintext = "tamper-resistant";
    const reserved = await quarantine.reserve({
      contentLength: plaintext.length,
      declaredMimeType: "text/plain",
      fileName: "tamper.txt",
      scope,
    });
    await quarantine.upload(reserved.id, scope, body(plaintext), plaintext.length);
    await quarantine.claim([reserved.id], scope);
    const [chunkKey] = await inspector.keys(`${prefix}:*:chunk:0`);
    expect(chunkKey).toBeDefined();
    const chunk = (await inspector.get(chunkKey!))!;
    const replacement = chunk.startsWith("A") ? "B" : "A";
    await inspector.set(
      chunkKey!, `${replacement}${chunk.slice(1)}`, { PX: 60_000 },
    );
    await expect(quarantine.readClaimed(reserved.id, scope))
      .rejects.toMatchObject({ code: "ATTACHMENT_INTEGRITY_FAILED" });
    await expect(quarantine.inspect(reserved.id, scope))
      .resolves.toMatchObject({ state: "rejected" });
    await quarantine.remove(reserved.id, scope);
  });

  it("admits only one upload and enforces quotas across replicas", async () => {
    const options = {
      encryptionKey: key,
      mimeDetector: detector,
      quotas: {
        maxAggregateBytesPerDraft: 4,
        maxBytesPerSession: 4,
        maxFileBytes: 4,
        maxFilesPerDraft: 1,
        maxGlobalBytes: 4,
        maxGlobalRecords: 1,
      },
      scanner,
    };
    const first = createSharedAttachmentQuarantine({
      ...options, directory: firstDirectory,
    });
    const second = createSharedAttachmentQuarantine({
      ...options, directory: secondDirectory,
    });
    const reserved = await first.reserve({
      contentLength: 4,
      declaredMimeType: "text/plain",
      fileName: "race.txt",
      scope,
    });
    await expect(second.reserve({
      contentLength: 1,
      declaredMimeType: "text/plain",
      fileName: "overflow.txt",
      scope,
    })).rejects.toMatchObject({ code: "ATTACHMENT_GLOBAL_QUOTA_EXCEEDED" });
    const uploads = await Promise.allSettled([
      first.upload(reserved.id, scope, body("race"), 4),
      second.upload(reserved.id, scope, body("race"), 4),
    ]);
    expect(uploads.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(uploads.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await first.remove(reserved.id, scope);
  });

  it("settles a multi-attachment selection atomically", async () => {
    const quarantine = createSharedAttachmentQuarantine({
      directory: firstDirectory, encryptionKey: key,
      mimeDetector: detector, scanner,
    });
    const reservations = await Promise.all(["one", "two"].map((value) =>
      quarantine.reserve({
        contentLength: value.length,
        declaredMimeType: "text/plain",
        fileName: `${value}.txt`,
        scope,
      })));
    await Promise.all(reservations.map((record, index) => {
      const value = index === 0 ? "one" : "two";
      return quarantine.upload(record.id, scope, body(value), value.length);
    }));
    const ids = reservations.map(({ id }) => id);
    await quarantine.claim(ids, scope);
    expect((await Promise.all(ids.map((id) =>
      quarantine.inspect(id, scope)))).every(({ state }) => state === "claimed"))
      .toBe(true);
    await quarantine.release(ids, scope);
    await quarantine.claim(ids, scope);
    const consumed = await quarantine.consume(ids, scope);
    expect(consumed.every(({ state }) => state === "consumed")).toBe(true);
    expect(await inspector.keys(`${prefix}:*`)).toEqual([]);
  });
});
