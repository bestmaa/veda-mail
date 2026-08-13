import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MailRuleDefinition } from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import {
  appendRuleAudit,
  type RuleAuditEntry,
} from "@/server/rules/rule-audit";
import { decryptRuleBook } from "@/server/rules/rule-crypto";
import { ruleFilePath } from "@/server/rules/rule-file";
import { ruleFileSchema } from "@/server/rules/rule-record";
import { ruleStore } from "@/server/rules/rule-store";

const originalData = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";
const owner = { email: "member@example.com", providerId: "mock" };
const definition: MailRuleDefinition = {
  actions: [{ kind: "mark-read" }],
  conditions: [{ field: "from", kind: "address", operator: "is", value: "secret@example.com" }],
  enabled: true,
  match: "all",
  name: "Private sender rule",
  stopProcessing: false,
};

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-mail-rules-sec-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 9).toString("base64");
});

afterEach(async () => {
  if (originalData === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalData;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("mail rule store security", () => {
  it("encrypts owner/rule values, isolates owners, and writes mode 0600", async () => {
    const book = await ruleStore.put(owner, {
      definition, expectedRevision: null, operation: "create",
    });
    await ruleStore.persistDeploymentIntent(owner, book.revision!, {
      config: { accessToken: "provider-secret" },
      createdAt: "2026-08-04T00:00:00.000Z",
      displayName: "Private provider",
      id: id.connection("11111111-1111-4111-8111-111111111111"),
      providerId: id.provider("mock"),
    });
    const pending = await ruleStore.get(owner);
    const [raw, metadata] = await Promise.all([
      readFile(ruleFilePath(), "utf8"),
      stat(ruleFilePath()),
    ]);
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(raw).not.toMatch(
      /member@example|secret@example|Private sender|Private provider|provider-secret|mock/u,
    );
    await expect(ruleStore.get({ email: "member@EXAMPLE.COM", providerId: "MOCK" }))
      .resolves.toMatchObject({ revision: pending.revision });
    await expect(ruleStore.get({ email: "Member@example.com", providerId: "mock" }))
      .resolves.toMatchObject({ revision: null, rules: [] });
  });

  it("fails closed on key and authentication-tag tampering", async () => {
    await ruleStore.put(owner, {
      definition, expectedRevision: null, operation: "create",
    });
    const file = ruleFileSchema.parse(JSON.parse(await readFile(ruleFilePath(), "utf8")));
    const ownerKey = Object.keys(file.owners)[0]!;
    const encrypted = file.owners[ownerKey]!;
    await writeFile(ruleFilePath(), JSON.stringify({
      ...file,
      owners: {
        ...file.owners,
        [ownerKey]: {
          ...encrypted,
          tag: `${encrypted.tag[0] === "A" ? "B" : "A"}${encrypted.tag.slice(1)}`,
        },
      },
    }), { mode: 0o600 });
    await expect(ruleStore.get(owner)).rejects.toMatchObject({
      code: "MAIL_RULE_STORE_UNAVAILABLE",
    });
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 8).toString("base64");
    await expect(ruleStore.get(owner)).rejects.toMatchObject({
      code: "MAIL_RULE_STORE_UNAVAILABLE",
    });
  });

  it("erases a superseded deployment connection on rule mutation", async () => {
    const created = await ruleStore.put(owner, {
      definition, expectedRevision: null, operation: "create",
    });
    const work = await ruleStore.persistDeploymentIntent(owner, created.revision!, {
      config: { accessToken: "provider-secret" },
      createdAt: "2026-08-04T00:00:00.000Z",
      displayName: "Private provider",
      id: id.connection("11111111-1111-4111-8111-111111111111"),
      providerId: id.provider("mock"),
    });
    const pending = await ruleStore.get(owner);
    await ruleStore.put(owner, {
      definition: { ...definition, name: "New desired rule" },
      expectedRevision: pending.revision,
      operation: "create",
    });
    const file = ruleFileSchema.parse(
      JSON.parse(await readFile(ruleFilePath(), "utf8")),
    );
    const ownerKey = Object.keys(file.owners)[0]!;
    expect(decryptRuleBook(file.owners[ownerKey]!, ownerKey).connection)
      .toBeNull();
    await expect(ruleStore.getDeploymentWork(owner, work.intentId)).rejects
      .toMatchObject({ code: "MAIL_RULE_DEPLOYMENT_CONFLICT" });
  });

  it("bounds audit history to redacted control-plane metadata", () => {
    let audit: readonly RuleAuditEntry[] = [];
    for (let index = 0; index < 550; index += 1) {
      audit = appendRuleAudit(
        audit, "toggle", crypto.randomUUID(), "2026-08-04T00:00:00.000Z",
      );
    }
    expect(audit).toHaveLength(500);
    expect(JSON.stringify(audit)).not.toMatch(/condition|email|provider|secret/u);
  });
});
