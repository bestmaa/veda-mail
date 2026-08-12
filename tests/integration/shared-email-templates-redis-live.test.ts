import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EmailTemplateOwner } from "@/domain/member/email-template";
import { id } from "@/domain/shared/brand";
import type { InstallationDraft } from
  "@/server/installation/installation.store";
import { installationStore } from
  "@/server/installation/installation.store";
import { hashAdminPassword } from
  "@/server/installation/password-hash";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";
import { updateEmailTemplateBook } from
  "@/server/templates/email-template-book";
import {
  emailTemplateOwnerKey,
  encryptEmailTemplateBook,
} from "@/server/templates/email-template-crypto";
import { emailTemplateFilePath } from
  "@/server/templates/email-template-file";
import { emailTemplateStore } from
  "@/server/templates/email-template.store";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:templates:${crypto.randomUUID()}`;
const owner: EmailTemplateOwner = {
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

describe.skipIf(!redisUrl)("live shared email templates", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-templates-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    await installationStore.complete(installation);
    await emailTemplateStore.put(owner, {
      content: {
        body: "Private template body", mode: "plain", subject: "Private subject",
      },
      expectedRevision: null, name: "Private template", operation: "create",
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
    const migrated = await emailTemplateStore.get(owner);
    expect(migrated.templates[0]?.name).toBe("Private template");
    const archived = `${emailTemplateFilePath()}.migrated-to-redis`;
    const archivedContents = await readFile(archived, "utf8");
    expect(archivedContents).not.toContain("Private template body");
    await expect(stat(emailTemplateFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const installed = await installationStore.get();
    if (!installed) throw new Error("Installation missing.");
    const secret = installed.sessionSecret;
    const ownerKey = emailTemplateOwnerKey(owner, secret);
    const expected = await sharedOwnerRepository.get("email-templates", ownerKey);
    expect(expected).not.toBeNull();
    const templateId = migrated.templates[0]!.id;
    const candidates = ["Replica A", "Replica B"].map((name) =>
      updateEmailTemplateBook(migrated, {
        content: { body: name, mode: "plain", subject: name },
        expectedRevision: migrated.revision, name, operation: "update",
        templateId,
      }, { body: name, subject: name }));
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "email-templates", ownerKey, expected,
        JSON.stringify(encryptEmailTemplateBook(book, ownerKey, secret)),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const winner = await emailTemplateStore.get(owner);
    expect(["Replica A", "Replica B"]).toContain(winner.templates[0]?.name);
    const keys = await inspector.keys(`${prefix}:*`);
    const redisSurface = JSON.stringify({
      keys, values: await inspector.mGet(keys),
    });
    expect(redisSurface).not.toContain("private@example.com");
    expect(redisSurface).not.toContain("Private template body");
    expect(redisSurface).not.toContain("Replica A");
    expect(redisSurface).not.toContain("Replica B");

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:email-templates:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    const replacement = tampered.ciphertext.startsWith("A") ? "B" : "A";
    tampered.ciphertext = `${replacement}${tampered.ciphertext.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(emailTemplateStore.get(owner)).rejects.toMatchObject({
      code: "TEMPLATE_STORE_UNAVAILABLE", status: 500,
    });
    await inspector.set(recordKey!, original);
    resetSharedStateRedisClientForTests();

    await emailTemplateStore.put(owner, {
      expectedRevision: winner.revision, operation: "delete", templateId,
    });
    expect(await sharedOwnerRepository.get("email-templates", ownerKey))
      .toBeNull();
  });
});
