import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MailForwardingLedger } from
  "@/server/mail-forwarding/mail-forwarding.schema";
import { mailForwardingStore } from
  "@/server/mail-forwarding/mail-forwarding.store";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:mail-forwarding:${crypto.randomUUID()}`;
const kind = "mail-forwarding" as const;
const key = Buffer.alloc(32, 91).toString("base64");
const ledger = (destinationEmail: string, revision: number): MailForwardingLedger => ({
  entries: [{
    destinationEmail,
    keepLocalCopy: true,
    sourceAddresses: ["private.member@example.com"],
    sourceEmail: "private.member@example.com",
    status: "active",
    updatedAt: "2026-08-24T00:00:00.000Z",
  }],
  revision,
  updatedAt: "2026-08-24T00:00:00.000Z",
  version: 1,
});

describe.skipIf(!redisUrl)("live shared mail forwarding", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-forwarding-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = key;
    await mailForwardingStore.put(0, ledger("private.archive@gmail.com", 1));
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
  });

  afterAll(async () => {
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    delete process.env["VEDA_MAIL_DATA_DIR"];
    delete process.env["VEDA_MAIL_JOB_KEY"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates only ciphertext and admits one exact concurrent revision", async () => {
    await expect(mailForwardingStore.get()).resolves.toEqual(
      ledger("private.archive@gmail.com", 1),
    );
    const archive = path.join(
      directory, "mail-forwarding.enc.json.migrated-to-redis",
    );
    expect(await readFile(archive, "utf8")).not.toContain("private.archive@gmail.com");
    await expect(stat(path.join(directory, "mail-forwarding.enc.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const results = await Promise.all([
      mailForwardingStore.put(1, ledger("first@outlook.com", 2)),
      mailForwardingStore.put(1, ledger("second@proton.me", 2)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect([
      "first@outlook.com", "second@proton.me",
    ]).toContain((await mailForwardingStore.get()).entries[0]?.destinationEmail);

    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      "private.member@example.com", "first@outlook.com", "second@proton.me",
      "destinationEmail", "sourceAddresses",
    ]) expect(surface).not.toContain(plaintext);

    const stored = await sharedRecordRepository.get(kind);
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 92).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(mailForwardingStore.get()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = key;

    const recordKey = keys.find((item) => item.endsWith(":value"))!;
    const tampered = JSON.parse(stored!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(mailForwardingStore.get()).rejects.toThrow();
  });
});
