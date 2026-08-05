import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from "@/server/installation/installation.store";
import { installationStore } from "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { messageListPreferencesFilePath } from "@/server/preferences/message-list-preferences-file";
import { messageListPreferencesStore } from "@/server/preferences/message-list-preferences.store";
import { storedMessageListPreferencesSchema } from "@/server/preferences/message-list-preferences-record";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let directory = "";
const owner = { email: "Member@Example.com", providerId: id.provider("mock") };
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

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-list-preferences-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  await installationStore.complete(installation);
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

describe("encrypted message list preferences store", () => {
  it("migrates legacy encrypted plaintext to safe sending defaults", () => {
    expect(storedMessageListPreferencesSchema.parse({
      preferences: {
        density: "spacious", showPreview: false, sort: "oldest",
      },
      updatedAt: "2026-08-02T00:00:00.000Z",
      version: 1,
    }).preferences).toEqual({
      confirmBeforeSend: false,
      density: "spacious",
      keyboardShortcuts: false,
      locale: "en-IN",
      showPreview: false,
      sort: "oldest",
      timeZone: "auto",
      undoSendSeconds: 0,
    });
  });

  it("migrates the previous sending shape to safe shortcut defaults", () => {
    expect(storedMessageListPreferencesSchema.parse({
      preferences: {
        confirmBeforeSend: true, density: "compact", showPreview: true,
        sort: "newest", undoSendSeconds: 10,
      },
      updatedAt: "2026-08-02T00:00:00.000Z",
      version: 1,
    }).preferences).toEqual({
      confirmBeforeSend: true, density: "compact", keyboardShortcuts: false,
      locale: "en-IN", showPreview: true, sort: "newest", timeZone: "auto",
      undoSendSeconds: 10,
    });
  });

  it("defaults, isolates owners, encrypts values, and persists canonical choices", async () => {
    await expect(messageListPreferencesStore.get(owner)).resolves.toEqual({
      confirmBeforeSend: false, density: "comfortable", showPreview: true,
      keyboardShortcuts: false, locale: "en-IN", sort: "newest",
      timeZone: "auto", undoSendSeconds: 0,
    });
    const saved = {
      confirmBeforeSend: true, density: "compact", showPreview: false,
      keyboardShortcuts: true, locale: "hi-IN", sort: "oldest",
      timeZone: "Asia/Kolkata", undoSendSeconds: 20,
    } as const;
    await expect(messageListPreferencesStore.set(owner, saved)).resolves.toEqual(saved);
    await expect(messageListPreferencesStore.get(owner)).resolves.toEqual(saved);
    await expect(messageListPreferencesStore.get({
      email: "other@example.com", providerId: owner.providerId,
    })).resolves.toEqual({
      confirmBeforeSend: false, density: "comfortable", showPreview: true,
      keyboardShortcuts: false, locale: "en-IN", sort: "newest",
      timeZone: "auto", undoSendSeconds: 0,
    });
    await expect(messageListPreferencesStore.get({
      email: owner.email, providerId: id.provider("other-provider"),
    })).resolves.toEqual({
      confirmBeforeSend: false, density: "comfortable", showPreview: true,
      keyboardShortcuts: false, locale: "en-IN", sort: "newest",
      timeZone: "auto", undoSendSeconds: 0,
    });
    await expect(messageListPreferencesStore.get({
      email: "Member@example.COM", providerId: id.provider("MOCK"),
    })).resolves.toEqual(saved);
    const [contents, fileStats] = await Promise.all([
      readFile(messageListPreferencesFilePath(), "utf8"),
      stat(messageListPreferencesFilePath()),
    ]);
    expect(fileStats.mode & 0o777).toBe(0o600);
    expect(contents).not.toContain("Member@Example.com");
    expect(contents).not.toContain("compact");
    expect(contents).not.toContain("hi-IN");
    expect(contents).not.toContain("oldest");
    expect(contents).not.toContain("Asia/Kolkata");
  });

  it("rejects values outside the strict preference schema", async () => {
    for (const invalid of [
      { density: "hostile", showPreview: true, sort: "newest" },
      { density: "compact", showPreview: "yes", sort: "newest" },
      { density: "compact", showPreview: true, sort: "sender" },
      {
        density: "compact",
        providerToken: "must-not-persist",
        showPreview: true,
        sort: "newest",
      },
    ]) {
      await expect(messageListPreferencesStore.set(owner, invalid as never))
        .rejects.toThrow();
    }
    await expect(readFile(messageListPreferencesFilePath(), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes concurrent writes without crossing owner buckets", async () => {
    const otherOwner = {
      email: "other@example.com",
      providerId: id.provider("mock"),
    };
    const first = {
      confirmBeforeSend: false, density: "compact", showPreview: false,
      keyboardShortcuts: false, locale: "en-IN", sort: "newest",
      timeZone: "auto", undoSendSeconds: 5,
    } as const;
    const second = {
      confirmBeforeSend: true, density: "comfortable", showPreview: true,
      keyboardShortcuts: true, locale: "ar", sort: "oldest",
      timeZone: "Asia/Riyadh", undoSendSeconds: 30,
    } as const;

    await Promise.all([
      messageListPreferencesStore.set(owner, first),
      messageListPreferencesStore.set(otherOwner, second),
    ]);

    await expect(messageListPreferencesStore.get(owner)).resolves.toEqual(first);
    await expect(messageListPreferencesStore.get(otherOwner)).resolves.toEqual(second);
  });

  it("fails closed with the stable unavailable contract for corrupted persistence", async () => {
    await messageListPreferencesStore.set(owner, {
      confirmBeforeSend: false, density: "compact", showPreview: false,
      keyboardShortcuts: false, locale: "en-IN", sort: "oldest",
      timeZone: "auto", undoSendSeconds: 0,
    });
    await writeFile(messageListPreferencesFilePath(), "{not-json", "utf8");

    await expect(messageListPreferencesStore.get(owner)).rejects.toMatchObject({
      code: "MESSAGE_LIST_PREFERENCES_UNAVAILABLE",
      message: "Message list preferences are temporarily unavailable.",
      status: 500,
    });
    await expect(messageListPreferencesStore.set(owner, {
      confirmBeforeSend: false, density: "comfortable", showPreview: true,
      keyboardShortcuts: false, locale: "en-IN", sort: "newest",
      timeZone: "auto", undoSendSeconds: 0,
    })).rejects.toMatchObject({
      code: "MESSAGE_LIST_PREFERENCES_UNAVAILABLE",
      status: 500,
    });
  });
});
