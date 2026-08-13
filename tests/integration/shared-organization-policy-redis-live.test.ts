import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { organizationPolicyRecordSchema } from
  "@/server/organization/organization-policy.schema";
import { organizationPolicyStore } from
  "@/server/organization/organization-policy.store";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:organization-policy:${crypto.randomUUID()}`;
const kind = "organization-policy" as const;

describe.skipIf(!redisUrl)("live shared organization policy", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-policy-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 41).toString("base64");
    await organizationPolicyStore.put({
      memberPasswordChange: false,
      memberProfileEditing: true,
      memberTwoFactorEnrollment: false,
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
    await expect(organizationPolicyStore.get()).resolves.toMatchObject({
      memberPasswordChange: false,
      memberTwoFactorEnrollment: false,
    });
    const archive = path.join(
      directory, "organization-policy.json.migrated-to-redis",
    );
    expect(JSON.parse(await readFile(archive, "utf8"))).toMatchObject({ version: 1 });
    await expect(stat(path.join(directory, "organization-policy.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const expected = await sharedRecordRepository.get(kind);
    expect(expected).not.toBeNull();
    const records = [false, true].map((memberProfileEditing) => ({
      policy: {
        memberPasswordChange: true,
        memberProfileEditing,
        memberTwoFactorEnrollment: true,
      },
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
      kind, stored!, organizationPolicyRecordSchema,
    ));
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      "memberPasswordChange", "memberProfileEditing",
      "memberTwoFactorEnrollment", "updatedAt",
    ]) expect(surface).not.toContain(plaintext);

    const replacement = {
      memberPasswordChange: false,
      memberProfileEditing: false,
      memberTwoFactorEnrollment: true,
    };
    await expect(organizationPolicyStore.put(replacement)).resolves.toEqual(replacement);
    await expect(organizationPolicyStore.get()).resolves.toEqual(replacement);
    stored = await sharedRecordRepository.get(kind);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 42).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(organizationPolicyStore.get()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 41).toString("base64");

    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    const tampered = JSON.parse(stored!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(organizationPolicyStore.get()).rejects.toThrow();
  });
});
