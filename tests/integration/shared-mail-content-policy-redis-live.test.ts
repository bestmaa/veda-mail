import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_MAIL_CONTENT_POLICY } from
  "@/domain/installation/mail-content-policy";
import { mailContentPolicyRecordSchema } from
  "@/server/organization/mail-content-policy.schema";
import { mailContentPolicyStore } from
  "@/server/organization/mail-content-policy.store";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:mail-policy:${crypto.randomUUID()}`;
const kind = "mail-content-policy" as const;
const privateExtension = "privateblocked";

describe.skipIf(!redisUrl)("live shared mail content policy", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-mail-policy-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 51).toString("base64");
    await mailContentPolicyStore.put({
      ...DEFAULT_MAIL_CONTENT_POLICY,
      blockedExtensions: [privateExtension],
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
    await expect(mailContentPolicyStore.get()).resolves.toMatchObject({
      blockedExtensions: [privateExtension],
    });
    const archive = path.join(
      directory, "mail-content-policy.json.migrated-to-redis",
    );
    expect(JSON.parse(await readFile(archive, "utf8"))).toMatchObject({ version: 1 });
    await expect(stat(path.join(directory, "mail-content-policy.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const expected = await sharedRecordRepository.get(kind);
    expect(expected).not.toBeNull();
    const records = ["exe", "js"].map((extension) => ({
      policy: { ...DEFAULT_MAIL_CONTENT_POLICY, blockedExtensions: [extension] },
      updatedAt: new Date().toISOString(),
      version: 1 as const,
    }));
    const results = await Promise.all(records.map((record) =>
      sharedRecordRepository.compareAndSet(
        kind, expected, encryptSharedRecord(kind, record),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    let stored = await sharedRecordRepository.get(kind);
    expect(records).toContainEqual(decryptSharedRecord(
      kind, stored!, mailContentPolicyRecordSchema,
    ));
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      privateExtension, "blockedExtensions", "maxAttachmentBytes", "updatedAt",
    ]) expect(surface).not.toContain(plaintext);

    const replacement = {
      ...DEFAULT_MAIL_CONTENT_POLICY,
      blockedMimeTypes: ["application/x-danger"],
    };
    await expect(mailContentPolicyStore.put(replacement)).resolves.toEqual(replacement);
    await expect(mailContentPolicyStore.get()).resolves.toEqual(replacement);
    stored = await sharedRecordRepository.get(kind);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 52).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(mailContentPolicyStore.get()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 51).toString("base64");

    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    const tampered = JSON.parse(stored!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(mailContentPolicyStore.get()).rejects.toThrow();
  });
});
