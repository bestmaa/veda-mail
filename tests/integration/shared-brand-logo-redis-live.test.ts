import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  readBrandLogo,
  removeBrandLogo,
  writeBrandLogo,
} from "@/server/branding/logo-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:brand-logo:${crypto.randomUUID()}`;

describe.skipIf(!redisUrl)("live shared brand logo", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  let migratedName = "";
  const migratedContents = Buffer.from("private normalized migrated webp");
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-logo-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    migratedName = await writeBrandLogo(migratedContents);
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 81).toString("base64");
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

  it("migrates opaque ciphertext and serves it across clients", async () => {
    await expect(readBrandLogo(migratedName)).resolves.toEqual(migratedContents);
    const local = path.join(directory, migratedName);
    await expect(stat(local)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(`${local}.migrated-to-redis`))
      .resolves.toEqual(migratedContents);

    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(migratedName)).resolves.toEqual(migratedContents);
    const keys = await inspector.keys(`${prefix}:*`);
    expect(keys).toHaveLength(2);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    expect(surface).not.toContain(migratedName);
    expect(surface).not.toContain(migratedContents.toString("utf8"));

    const nextContents = Buffer.from("second private normalized webp");
    const nextName = await writeBrandLogo(nextContents);
    await expect(stat(path.join(directory, nextName)))
      .rejects.toMatchObject({ code: "ENOENT" });
    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(nextName)).resolves.toEqual(nextContents);

    const records = (await inspector.keys(`${prefix}:*`))
      .filter((key) => !key.endsWith(":key-check"));
    expect(records).toHaveLength(2);
    const values = await inspector.mGet(records);
    await inspector.mSet([
      [records[0]!, values[1]!],
      [records[1]!, values[0]!],
    ]);
    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(migratedName)).rejects.toThrow();
    await inspector.mSet([
      [records[0]!, values[0]!],
      [records[1]!, values[1]!],
    ]);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 82).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(nextName)).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 81).toString("base64");

    const oversized = "x".repeat(3 * 1_024 * 1_024 + 1);
    await inspector.mSet(records.map((key) => [key, oversized]));
    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(migratedName)).rejects.toThrow();
    await inspector.mSet(records.map((key, index) => [key, values[index]!]));

    await removeBrandLogo(nextName);
    resetSharedStateRedisClientForTests();
    await expect(readBrandLogo(nextName)).resolves.toBeNull();
  });
});
