import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LabelOwner } from "@/domain/mail/label";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { labelCatalogOwnerKey } from
  "@/server/labels/label-catalog-crypto";
import { labelCatalogFilePath } from
  "@/server/labels/label-catalog-file";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:labels:${crypto.randomUUID()}`;
const owner: LabelOwner = {
  email: "private@example.com", providerId: id.provider("mock"),
};
const installation = async (): Promise<InstallationDraft> => ({
  mailProfile: {
    allowedDomains: ["example.com"], config: {}, displayName: "Mail",
    providerId: id.provider("mock"),
  },
  organization: {
    accentColor: "#ff6b57", logoFileName: null, organizationName: "Example",
    primaryColor: "#27276f", productName: "Mail", publicRepositoryUrl: null,
  },
  owner: {
    password: await hashAdminPassword("strong-password-123"), username: "owner",
  },
});

describe.skipIf(!redisUrl)("live shared label catalogs", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-labels-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await labelCatalogStore.create(owner, {
      color: "#4f46e5", name: "Private label",
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
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates ciphertext and preserves concurrent catalog writes", async () => {
    await expect(labelCatalogStore.list(owner)).resolves.toMatchObject([
      { name: "Private label" },
    ]);
    const archived = `${labelCatalogFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain("Private label");
    await expect(stat(labelCatalogFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    await Promise.all(Array.from({ length: 12 }, (_, index) =>
      labelCatalogStore.create(owner, {
        color: "#64748b", name: `Replica label ${index}`,
      })));
    resetSharedStateRedisClientForTests();
    const labels = await labelCatalogStore.list(owner);
    expect(labels).toHaveLength(13);
    expect(new Set(labels.map(({ id: labelId }) => labelId)).size).toBe(13);

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const ownerKey = labelCatalogOwnerKey(owner, installed.sessionSecret);
    expect(await sharedOwnerRepository.get("label-catalogs", ownerKey))
      .not.toBeNull();
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const value of [
      "private@example.com", "Private label", "Replica label",
      ...labels.map(({ id: labelId }) => labelId),
    ]) expect(surface).not.toContain(value);

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:label-catalogs:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    const replacement = tampered.ciphertext.startsWith("A") ? "B" : "A";
    tampered.ciphertext = `${replacement}${tampered.ciphertext.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(labelCatalogStore.list(owner)).rejects.toMatchObject({
      code: "LABELS_UNAVAILABLE", status: 500,
    });
  });
});
