import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SavedSearchOwner } from "@/domain/mail/saved-search";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from
  "@/server/installation/password-hash";
import { updateSavedSearchBook } from
  "@/server/saved-searches/saved-search-book";
import { encryptSavedSearchBook, savedSearchOwnerKey } from
  "@/server/saved-searches/saved-search-crypto";
import { savedSearchFilePath } from
  "@/server/saved-searches/saved-search-file";
import { savedSearchStore } from
  "@/server/saved-searches/saved-search-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:saved-searches:${crypto.randomUUID()}`;
const owner: SavedSearchOwner = {
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

describe.skipIf(!redisUrl)("live shared saved searches", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-searches-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await savedSearchStore.put(owner, {
      expectedRevision: null, name: "Private search", operation: "create",
      query: "from:private@example.com",
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

  it("migrates encrypted data and atomically resolves replica updates", async () => {
    const migrated = await savedSearchStore.get(owner);
    expect(migrated.searches[0]?.name).toBe("Private search");
    const archived = `${savedSearchFilePath()}.migrated-to-redis`;
    const archivedContents = await readFile(archived, "utf8");
    expect(archivedContents).not.toContain("private@example.com");
    await expect(stat(savedSearchFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const ownerKey = savedSearchOwnerKey(owner, installed.sessionSecret);
    const expected = await sharedOwnerRepository.get("saved-searches", ownerKey);
    expect(expected).not.toBeNull();
    const tampered = JSON.parse(expected!);
    const replacement = tampered.ciphertext.startsWith("A") ? "B" : "A";
    tampered.ciphertext = `${replacement}${tampered.ciphertext.slice(1)}`;
    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:saved-searches:record:*`,
    );
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(savedSearchStore.get(owner)).rejects.toMatchObject({
      code: "SAVED_SEARCH_STORE_UNAVAILABLE", status: 500,
    });
    await inspector.set(recordKey!, expected!);
    resetSharedStateRedisClientForTests();

    const searchId = migrated.searches[0]!.id;
    const first = updateSavedSearchBook(migrated, {
      expectedRevision: migrated.revision, name: "Replica A",
      operation: "update", query: "is:unread", searchId,
    });
    const second = updateSavedSearchBook(migrated, {
      expectedRevision: migrated.revision, name: "Replica B",
      operation: "update", query: "is:starred", searchId,
    });
    const candidates = [first, second];
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "saved-searches", ownerKey, expected,
        JSON.stringify(encryptSavedSearchBook(
          book, ownerKey, installed.sessionSecret,
        )),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const winner = await savedSearchStore.get(owner);
    expect(["Replica A", "Replica B"]).toContain(winner.searches[0]?.name);
    const redisSurface = JSON.stringify({
      keys: await inspector.keys(`${prefix}:*`),
      values: await inspector.mGet(await inspector.keys(`${prefix}:*`)),
    });
    expect(redisSurface).not.toContain("private@example.com");
    expect(redisSurface).not.toContain("Replica A");
    expect(redisSurface).not.toContain("Replica B");

    await savedSearchStore.put(owner, {
      expectedRevision: winner.revision, operation: "delete", searchId,
    });
    expect(await sharedOwnerRepository.get("saved-searches", ownerKey)).toBeNull();
    resetSharedStateRedisClientForTests();
    await expect(savedSearchStore.get(owner)).resolves.toMatchObject({
      revision: null, searches: [],
    });
  });
});
