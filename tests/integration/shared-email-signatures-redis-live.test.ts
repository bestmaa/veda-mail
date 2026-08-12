import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailSignatureOwner } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from
  "@/server/installation/password-hash";
import { updateEmailSignatureBook } from
  "@/server/signatures/email-signature-book";
import {
  emailSignatureOwnerKey,
  encryptEmailSignatureBook,
} from "@/server/signatures/email-signature-crypto";
import { emailSignatureFilePath } from
  "@/server/signatures/email-signature-file";
import { emailSignatureStore } from
  "@/server/signatures/email-signature.store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:signatures:${crypto.randomUUID()}`;
const owner: EmailSignatureOwner = {
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

describe.skipIf(!redisUrl)("live shared email signatures", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-signatures-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await emailSignatureStore.put(owner, {
      content: { body: "Private regards", mode: "plain" },
      expectedRevision: null, name: "Private work", operation: "create",
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

  it("migrates ciphertext and admits one competing revision", async () => {
    const migrated = await emailSignatureStore.get(owner);
    expect(migrated.signatures[0]?.name).toBe("Private work");
    const archived = `${emailSignatureFilePath()}.migrated-to-redis`;
    const archivedContents = await readFile(archived, "utf8");
    expect(archivedContents).not.toContain("Private regards");
    await expect(stat(emailSignatureFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const secret = installed.sessionSecret;
    const ownerKey = emailSignatureOwnerKey(owner, secret);
    const expected = await sharedOwnerRepository.get("email-signatures", ownerKey);
    expect(expected).not.toBeNull();
    const signatureId = migrated.signatures[0]!.id;
    const candidates = ["Replica A", "Replica B"].map((name) =>
      updateEmailSignatureBook(migrated, {
        content: { body: name, mode: "plain" },
        expectedRevision: migrated.revision, name, operation: "update",
        signatureId,
      }, { body: name }));
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "email-signatures", ownerKey, expected,
        JSON.stringify(encryptEmailSignatureBook(book, ownerKey, secret)),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const winner = await emailSignatureStore.get(owner);
    expect(["Replica A", "Replica B"]).toContain(winner.signatures[0]?.name);
    const redisSurface = JSON.stringify({
      keys: await inspector.keys(`${prefix}:*`),
      values: await inspector.mGet(await inspector.keys(`${prefix}:*`)),
    });
    expect(redisSurface).not.toContain("private@example.com");
    expect(redisSurface).not.toContain("Private regards");
    expect(redisSurface).not.toContain("Replica A");
    expect(redisSurface).not.toContain("Replica B");

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:email-signatures:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    const replacement = tampered.ciphertext.startsWith("A") ? "B" : "A";
    tampered.ciphertext = `${replacement}${tampered.ciphertext.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(emailSignatureStore.get(owner)).rejects.toMatchObject({
      code: "SIGNATURE_STORE_UNAVAILABLE", status: 500,
    });
    await inspector.set(recordKey!, original);
    resetSharedStateRedisClientForTests();

    await emailSignatureStore.put(owner, {
      expectedRevision: winner.revision, operation: "delete", signatureId,
    });
    expect(await sharedOwnerRepository.get("email-signatures", ownerKey))
      .toBeNull();
  });
});
