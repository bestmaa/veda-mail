import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  replaceSharedInstallation,
  resetInstallationMigrationForTests,
  sharedInstallation,
} from "@/server/installation/installation-shared";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:installation:${crypto.randomUUID()}`;
const kind = "installation" as const;

describe.skipIf(!redisUrl)("live shared installation record", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-install-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 71).toString("base64");
    await installationStore.complete(async () => ({
      mailProfile: {
        allowedDomains: ["private.example"],
        config: { baseUrl: "https://mail.private.example" },
        displayName: "Private Mail",
        providerId: id.provider("stalwart-jmap"),
      },
      organization: {
        accentColor: "#ff6b57",
        logoFileName: null,
        organizationName: "Private Organization",
        primaryColor: "#27276f",
        productName: "Private Product",
        publicRepositoryUrl: "https://github.com/private/mail",
      },
      owner: {
        password: await hashAdminPassword("private-password-123"),
        username: "private-owner",
      },
    }));
    process.env["VEDA_MAIL_STATE_REDIS_URL"] = redisUrl;
    process.env["VEDA_MAIL_STATE_REDIS_PREFIX"] = prefix;
    await inspector.connect();
    await clear();
  });

  afterAll(async () => {
    resetInstallationMigrationForTests();
    resetSharedStateRedisClientForTests();
    await clear();
    inspector.destroy();
    await rm(directory, { force: true, recursive: true });
    delete process.env["VEDA_MAIL_DATA_DIR"];
    delete process.env["VEDA_MAIL_JOB_KEY"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates encrypted state and admits one exact concurrent update", async () => {
    const migrated = await installationStore.get();
    expect(migrated).toMatchObject({
      organization: { organizationName: "Private Organization" },
      owner: { username: "private-owner" },
    });
    const archive = path.join(
      directory, "installation.json.migrated-to-redis",
    );
    expect(JSON.parse(await readFile(archive, "utf8"))).toMatchObject({
      owner: { username: "private-owner" },
      version: 1,
    });
    await expect(stat(path.join(directory, "installation.json")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const expected = await sharedInstallation();
    const candidates = ["Replica A", "Replica B"].map((organizationName) => ({
      ...expected.installation!,
      organization: { ...expected.installation!.organization, organizationName },
      updatedAt: new Date().toISOString(),
    }));
    const results = await Promise.all(candidates.map((candidate) =>
      replaceSharedInstallation(expected, candidate),
    ));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(candidates).toContainEqual((await sharedInstallation()).installation);

    const current = (await installationStore.get())!;
    await expect(installationStore.updateOwner(current.owner.authVersion, {
      password: current.owner.password,
      twoFactor: null,
      username: "updated-private-owner",
    })).resolves.toMatchObject({
      owner: { authVersion: current.owner.authVersion + 1 },
    });
    await expect(installationStore.updateOwner(current.owner.authVersion, {
      password: current.owner.password,
      twoFactor: null,
      username: "stale-owner",
    })).rejects.toMatchObject({ code: "ADMIN_ACCOUNT_CHANGED", status: 409 });

    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const plaintext of [
      "private-owner", "private.example", "Private Organization",
      migrated!.sessionSecret, "password", "sessionSecret",
    ]) expect(surface).not.toContain(plaintext);

    const serialized = await sharedRecordRepository.get(kind);
    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    await inspector.set(recordKey, "x".repeat(3 * 1_024 * 1_024 + 1));
    resetSharedStateRedisClientForTests();
    await expect(installationStore.get()).rejects.toThrow();
    await inspector.set(recordKey, serialized!);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 72).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(installationStore.get()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 71).toString("base64");

    const tampered = JSON.parse(serialized!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(installationStore.get()).rejects.toThrow();
  });
});
