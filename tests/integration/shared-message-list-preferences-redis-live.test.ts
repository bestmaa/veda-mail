import { mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from
  "@/server/installation/password-hash";
import {
  messageListPreferencesFilePath,
  readMessageListPreferencesFile,
  writeMessageListPreferencesFile,
} from
  "@/server/preferences/message-list-preferences-file";
import { messageListPreferencesFileSchema } from
  "@/server/preferences/message-list-preferences-record";
import { messageListPreferencesStore } from
  "@/server/preferences/message-list-preferences.store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:member-settings:${crypto.randomUUID()}`;
const owner = { email: "private@example.com", providerId: id.provider("mock") };
const first = {
  confirmBeforeSend: true, density: "compact", keyboardShortcuts: true,
  locale: "hi-IN", showPreview: false, sort: "oldest",
  timeZone: "Asia/Kolkata", undoSendSeconds: 20,
} as const;
const second = {
  confirmBeforeSend: false, density: "spacious", keyboardShortcuts: false,
  locale: "ar", showPreview: true, sort: "newest",
  timeZone: "Asia/Riyadh", undoSendSeconds: 5,
} as const;
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

describe.skipIf(!redisUrl)("live shared message-list preferences", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-prefs-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await messageListPreferencesStore.set(owner, first);
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

  it("migrates encrypted local data and shares later updates", async () => {
    await expect(messageListPreferencesStore.get(owner)).resolves.toEqual(first);
    const archived = `${messageListPreferencesFilePath()}.migrated-to-redis`;
    const archivedContents = await readFile(archived, "utf8");
    await expect(stat(messageListPreferencesFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(archivedContents).not.toContain("Asia/Kolkata");

    resetSharedStateRedisClientForTests();
    await messageListPreferencesStore.set(owner, second);
    resetSharedStateRedisClientForTests();
    await expect(messageListPreferencesStore.get(owner)).resolves.toEqual(second);
    await expect(messageListPreferencesStore.get({
      email: "new-owner@example.com", providerId: id.provider("mock"),
    })).resolves.toMatchObject({
      density: "comfortable", showPreview: true, sort: "newest",
    });

    const keys = await inspector.keys(`${prefix}:*`);
    const values = await inspector.mGet(keys);
    const surface = JSON.stringify({ keys, values });
    expect(surface).not.toContain("private@example.com");
    expect(surface).not.toContain("Asia/Kolkata");
    expect(surface).not.toContain("Asia/Riyadh");

    const archivedFile = messageListPreferencesFileSchema.parse(
      JSON.parse(archivedContents),
    );
    await writeMessageListPreferencesFile(archivedFile);
    await expect(sharedOwnerRepository.ensureMigrated(
      "message-list-preferences",
      async () => Object.fromEntries(Object.entries(
        (await readMessageListPreferencesFile()).owners,
      ).map(([key, value]) => [key, JSON.stringify(value)])),
      async () => undefined,
    )).rejects.toMatchObject({ code: "SHARED_OWNER_MIGRATION_CONFLICT" });
    await unlink(messageListPreferencesFilePath());
  });
});
