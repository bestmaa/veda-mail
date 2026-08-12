import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ContactOwner } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import { updateContactBook } from "@/server/contacts/contact-book";
import { contactOwnerKey, decryptContactBook, encryptContactBook } from
  "@/server/contacts/contact-crypto";
import { contactFilePath } from "@/server/contacts/contact-file";
import { encryptedContactBookSchema } from "@/server/contacts/contact-record";
import { contactStore } from "@/server/contacts/contact-store";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:contacts:${crypto.randomUUID()}`;
const owner: ContactOwner = {
  email: "private@example.com", providerId: "mock",
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

describe.skipIf(!redisUrl)("live shared contacts", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-contacts-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await contactStore.put(owner, {
      contact: {
        emails: [{ email: "person@example.com", label: "Work" }],
        name: "Private person",
      },
      expectedRevision: null, operation: "create-contact",
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

  it("migrates ciphertext, coordinates revisions, and retries recents", async () => {
    const migrated = await contactStore.get(owner);
    expect(migrated.contacts[0]?.name).toBe("Private person");
    const archived = `${contactFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain("Private person");
    await expect(stat(contactFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const secret = installed.sessionSecret;
    const ownerKey = contactOwnerKey(owner, secret);
    const expected = await sharedOwnerRepository.get("contacts", ownerKey);
    expect(expected).not.toBeNull();
    const candidates = ["Replica A", "Replica B"].map((name) =>
      updateContactBook(migrated, {
        contact: {
          emails: [{ email: `${name.at(-1)!.toLowerCase()}@example.com`, label: null }],
          name,
        },
        expectedRevision: migrated.revision, operation: "create-contact",
      }));
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "contacts", ownerKey, expected,
        JSON.stringify(encryptContactBook(book, ownerKey, secret)),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const replicaMutation = async (): Promise<void> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const serialized = await sharedOwnerRepository.get("contacts", ownerKey);
        const encrypted = encryptedContactBookSchema.parse(
          JSON.parse(serialized!),
        );
        const current = decryptContactBook(encrypted, ownerKey, secret);
        const first = current.contacts[0]!;
        const updated = updateContactBook(current, {
          contact: { emails: first.emails, name: "Replica contact update" },
          contactId: first.id, expectedRevision: current.revision,
          operation: "update-contact",
        });
        if (await sharedOwnerRepository.compareAndSet(
          "contacts", ownerKey, serialized,
          JSON.stringify(encryptContactBook(updated, ownerKey, secret)),
        )) return;
      }
      throw new Error("Competing contact replica exhausted CAS attempts.");
    };
    await Promise.all([
      replicaMutation(),
      contactStore.recordRecents(owner, [{
        email: "recent@example.com", name: "Recent person",
      }]),
    ]);
    const winner = await contactStore.get(owner);
    expect(winner.contacts).toHaveLength(2);
    expect(winner.contacts[0]?.name).toBe("Replica contact update");
    expect(winner.recents[0]?.email).toBe("recent@example.com");
    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const privateValue of [
      "private@example.com", "Private person", "recent@example.com",
      "Recent person", "Replica A", "Replica B", "Replica contact update",
    ]) expect(surface).not.toContain(privateValue);

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:contacts:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(contactStore.get(owner)).rejects.toMatchObject({
      code: "CONTACT_STORE_UNAVAILABLE", status: 500,
    });
  });
});
