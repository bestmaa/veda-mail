import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dataRetentionPolicyRecordSchema } from
  "@/server/organization/data-retention-policy.schema";
import { dataRetentionPolicyStore } from
  "@/server/organization/data-retention-policy.store";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:retention:${crypto.randomUUID()}`;
const kind = "data-retention-policy" as const;

describe.skipIf(!redisUrl)("live shared data retention policy", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-retention-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 31).toString("base64");
    await dataRetentionPolicyStore.put({
      securityAuditMaxAgeDays: 90,
      securityAuditMaxEntries: 2_000,
    });
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

  it("migrates ciphertext and admits one exact concurrent replacement", async () => {
    await expect(dataRetentionPolicyStore.get()).resolves.toEqual({
      securityAuditMaxAgeDays: 90,
      securityAuditMaxEntries: 2_000,
    });
    const archive = path.join(
      directory, "data-retention-policy.json.migrated-to-redis",
    );
    expect(JSON.parse(await readFile(archive, "utf8"))).toMatchObject({
      policy: { securityAuditMaxAgeDays: 90 }, version: 1,
    });
    await expect(stat(path.join(directory, "data-retention-policy.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const expected = await sharedRecordRepository.get(kind);
    expect(expected).not.toBeNull();
    const records = [30, 60].map((securityAuditMaxAgeDays) => ({
      policy: { securityAuditMaxAgeDays, securityAuditMaxEntries: 1_000 },
      updatedAt: new Date().toISOString(),
      version: 1 as const,
    }));
    const results = await Promise.all(records.map((record) =>
      sharedRecordRepository.compareAndSet(
        kind, expected, encryptSharedRecord(kind, record),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    let stored = await sharedRecordRepository.get(kind);
    const decrypted = decryptSharedRecord(
      kind, stored!, dataRetentionPolicyRecordSchema,
    );
    expect(records).toContainEqual(decrypted);
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      "securityAuditMaxAgeDays", "securityAuditMaxEntries", "updatedAt",
    ]) expect(surface).not.toContain(plaintext);

    const replacement = {
      securityAuditMaxAgeDays: 120,
      securityAuditMaxEntries: 3_000,
    };
    await expect(dataRetentionPolicyStore.put(replacement)).resolves.toEqual(replacement);
    await expect(dataRetentionPolicyStore.get()).resolves.toEqual(replacement);
    stored = await sharedRecordRepository.get(kind);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 32).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(dataRetentionPolicyStore.get()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 31).toString("base64");

    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    const tampered = JSON.parse(stored!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(dataRetentionPolicyStore.get()).rejects.toThrow();
  });
});
