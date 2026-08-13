import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MailRuleDefinition } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { updateRuleBook } from "@/server/rules/rule-book";
import {
  decryptRuleBook,
  encryptRuleBook,
  ruleOwnerKey,
} from "@/server/rules/rule-crypto";
import { ruleFilePath } from "@/server/rules/rule-file";
import {
  encryptedRuleBookSchema,
  type MailRuleOwner,
} from "@/server/rules/rule-record";
import { ruleStore } from "@/server/rules/rule-store";
import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:rules:${crypto.randomUUID()}`;
const owner: MailRuleOwner = {
  email: "private@example.com", providerId: "mock",
};
const definition = (name: string): MailRuleDefinition => ({
  actions: [{ kind: "star" }],
  conditions: [{ kind: "subject", operator: "contains", value: "private phrase" }],
  enabled: true,
  match: "all",
  name,
  stopProcessing: false,
});

describe.skipIf(!redisUrl)("live shared mail rules", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-rules-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 13).toString("base64");
    const created = await ruleStore.put(owner, {
      definition: definition("Private local rule"),
      expectedRevision: null,
      operation: "create",
    });
    await ruleStore.persistDeploymentIntent(owner, created.revision!, {
      config: { accessToken: "provider-secret" },
      createdAt: "2026-08-13T00:00:00.000Z",
      displayName: "Private provider",
      id: id.connection("11111111-1111-4111-8111-111111111111"),
      providerId: id.provider("mock"),
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
    delete process.env["VEDA_MAIL_JOB_KEY"];
    delete process.env["VEDA_MAIL_STATE_REDIS_URL"];
    delete process.env["VEDA_MAIL_STATE_REDIS_PREFIX"];
  });

  it("migrates ciphertext and coordinates exact rule-book revisions", async () => {
    const migrated = await ruleStore.get(owner);
    expect(migrated.rules[0]?.name).toBe("Private local rule");
    const intentId = migrated.deployment.intentId!;
    await expect(ruleStore.getDeploymentWork(owner, intentId)).resolves
      .toMatchObject({ connection: { config: { accessToken: "provider-secret" } } });

    const archived = `${ruleFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain("Private local rule");
    await expect(stat(ruleFilePath())).rejects.toMatchObject({ code: "ENOENT" });

    const ownerKey = ruleOwnerKey(owner);
    const expected = await sharedOwnerRepository.get("mail-rules", ownerKey);
    const encrypted = encryptedRuleBookSchema.parse(JSON.parse(expected!));
    const current = decryptRuleBook(encrypted, ownerKey);
    const candidates = ["Replica A", "Replica B"].map((name) =>
      updateRuleBook(current, {
        definition: definition(name),
        expectedRevision: current.revision,
        operation: "create",
      }, new Date().toISOString()));
    const results = await Promise.all(candidates.map((book) =>
      sharedOwnerRepository.compareAndSet(
        "mail-rules", ownerKey, expected,
        JSON.stringify(encryptRuleBook(book, ownerKey)),
      )));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const winner = await ruleStore.get(owner);
    expect(winner.rules).toHaveLength(2);
    expect(winner.rules.some(({ name }) => name === "Replica A" ||
      name === "Replica B")).toBe(true);
    await expect(ruleStore.put(owner, {
      definition: definition("Stale replica"),
      expectedRevision: migrated.revision,
      operation: "create",
    })).rejects.toMatchObject({ code: "MAIL_RULE_BOOK_CONFLICT", status: 409 });

    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const privateValue of [
      "private@example.com", "Private local rule", "private phrase",
      "Private provider", "provider-secret", "Replica A", "Replica B",
    ]) expect(surface).not.toContain(privateValue);

    const [recordKey] = await inspector.keys(
      `${prefix}:owner-record:mail-rules:record:*`,
    );
    const original = (await inspector.get(recordKey!))!;
    const tampered = JSON.parse(original);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey!, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(ruleStore.get(owner)).rejects.toMatchObject({
      code: "MAIL_RULE_STORE_UNAVAILABLE", status: 500,
    });
  });
});
