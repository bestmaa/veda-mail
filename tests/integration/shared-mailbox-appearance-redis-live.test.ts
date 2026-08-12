import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Mailbox, MailboxAppearanceOwner } from "@/domain/mail/mailbox";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from
  "@/server/installation/password-hash";
import {
  decryptMailboxAppearanceBook,
  encryptMailboxAppearanceBook,
  mailboxAppearanceOwnerKey,
} from "@/server/mailboxes/mailbox-appearance-crypto";
import { mailboxAppearanceFilePath } from
  "@/server/mailboxes/mailbox-appearance-file";
import { encryptedMailboxAppearanceBookSchema } from
  "@/server/mailboxes/mailbox-appearance-record";
import { mailboxAppearanceStore } from
  "@/server/mailboxes/mailbox-appearance.store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:mailbox-appearance:${crypto.randomUUID()}`;
const owner: MailboxAppearanceOwner = {
  email: "private@example.com", providerId: id.provider("mock"),
};
const mailbox = (value: string): Mailbox => ({
  color: "#64748b", id: id.mailbox(value), name: value, parentId: null,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  role: "custom", sortOrder: 0, total: 0, unread: 0,
});
const firstMailbox = mailbox("private-first-folder");
const secondMailbox = mailbox("private-second-folder");
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

describe.skipIf(!redisUrl)("live shared mailbox appearance", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-colors-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await mailboxAppearanceStore.set(owner, firstMailbox.id, "#a855f7");
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

  it("migrates ciphertext and preserves competing replica updates", async () => {
    await expect(mailboxAppearanceStore.decorate(owner, [firstMailbox]))
      .resolves.toMatchObject([{ color: "#a855f7" }]);
    const archived = `${mailboxAppearanceFilePath()}.migrated-to-redis`;
    const archivedContents = await readFile(archived, "utf8");
    expect(archivedContents).not.toContain("private-first-folder");
    await expect(stat(mailboxAppearanceFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const secret = installed.sessionSecret;
    const ownerKey = mailboxAppearanceOwnerKey(owner, secret);
    const replicaMutation = async (): Promise<void> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const expected = await sharedOwnerRepository.get(
          "mailbox-appearance", ownerKey,
        );
        const encrypted = encryptedMailboxAppearanceBookSchema.parse(
          JSON.parse(expected!),
        );
        const current = decryptMailboxAppearanceBook(encrypted, ownerKey, secret);
        const next = encryptMailboxAppearanceBook({
          ...current,
          colors: { ...current.colors, [firstMailbox.id]: "#ef4444" },
          updatedAt: new Date().toISOString(),
        }, ownerKey, secret);
        if (await sharedOwnerRepository.compareAndSet(
          "mailbox-appearance", ownerKey, expected, JSON.stringify(next),
        )) return;
      }
      throw new Error("Competing replica exhausted CAS attempts.");
    };
    await Promise.all([
      replicaMutation(),
      mailboxAppearanceStore.set(owner, secondMailbox.id, "#10b981"),
    ]);
    resetSharedStateRedisClientForTests();
    await expect(mailboxAppearanceStore.decorate(
      owner, [firstMailbox, secondMailbox],
    )).resolves.toMatchObject([
      { color: "#ef4444" }, { color: "#10b981" },
    ]);

    const redisSurface = JSON.stringify({
      keys: await inspector.keys(`${prefix}:*`),
      values: await inspector.mGet(await inspector.keys(`${prefix}:*`)),
    });
    expect(redisSurface).not.toContain("private@example.com");
    expect(redisSurface).not.toContain("private-first-folder");
    expect(redisSurface).not.toContain("private-second-folder");

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:mailbox-appearance:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    const replacement = tampered.ciphertext.startsWith("A") ? "B" : "A";
    tampered.ciphertext = `${replacement}${tampered.ciphertext.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(mailboxAppearanceStore.decorate(owner, [firstMailbox]))
      .rejects.toMatchObject({ code: "MAILBOX_APPEARANCE_UNAVAILABLE" });
    await inspector.set(recordKey!, original);
    resetSharedStateRedisClientForTests();

    await mailboxAppearanceStore.remove(owner, firstMailbox.id);
    await mailboxAppearanceStore.remove(owner, secondMailbox.id);
    expect(await sharedOwnerRepository.get("mailbox-appearance", ownerKey))
      .toBeNull();
  });
});
