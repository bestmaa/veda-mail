import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetSharedStateRedisClientForTests } from
  "@/server/shared-state/shared-state-redis";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";
import { securityAuditFilePath } from
  "@/server/security-audit/security-audit-file";
import { assertSecurityAuditIntegrity } from
  "@/server/security-audit/security-audit-integrity";
import { securityAuditSubjectId } from
  "@/server/security-audit/security-audit-key";
import {
  sharedSecurityAudit,
  replaceSharedSecurityAudit,
} from "@/server/security-audit/security-audit-shared";
import {
  appendSecurityAuditFile,
  securityAuditStore,
} from "@/server/security-audit/security-audit.store";
import type { SecurityAuditAppend } from
  "@/server/security-audit/security-audit-record";

const redisUrl = process.env["VEDA_MAIL_TEST_REDIS_URL"];
const prefix = `veda-mail:test:security-audit:${crypto.randomUUID()}`;
const privateIdentity = "private-audit-user@example.com";
const actorId = () => securityAuditSubjectId(
  "actor", `member:${privateIdentity}`,
);
const event = (
  outcome: SecurityAuditAppend["outcome"] = "success",
): SecurityAuditAppend => ({
  action: "member.authentication.succeeded",
  actorId: actorId(),
  actorType: "member",
  count: null,
  outcome,
  requestId: null,
  targetId: null,
  targetType: "authentication",
});

describe.skipIf(!redisUrl)("live shared security audit", () => {
  const inspector = createClient({ url: redisUrl! });
  let directory = "";
  const clear = async () => {
    const keys = await inspector.keys(`${prefix}:*`);
    if (keys.length > 0) await inspector.del(keys);
  };

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "veda-shared-audit-"));
    process.env["VEDA_MAIL_DATA_DIR"] = directory;
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 21).toString("base64");
    await securityAuditStore.append(event());
    await securityAuditStore.append(event("failure"));
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

  it("migrates ciphertext and preserves one global CAS sequence", async () => {
    const migrated = await securityAuditStore.list();
    expect(migrated.entries.map(({ sequence }) => sequence)).toEqual([2, 1]);
    const archived = `${securityAuditFilePath()}.migrated-to-redis`;
    expect(await readFile(archived, "utf8")).not.toContain(privateIdentity);
    await expect(stat(securityAuditFilePath()))
      .rejects.toMatchObject({ code: "ENOENT" });

    const left = await sharedSecurityAudit();
    const right = await sharedSecurityAudit();
    const candidates = [left, right].map((current, index) => ({
      current,
      updated: appendSecurityAuditFile(
        current.file,
        event(index === 0 ? "success" : "partial"),
      ),
    }));
    const results = await Promise.all(candidates.map(({ current, updated }) =>
      replaceSharedSecurityAudit(current, updated)));
    expect(results.filter(Boolean)).toHaveLength(1);

    resetSharedStateRedisClientForTests();
    const appended = await securityAuditStore.append(event());
    expect(appended.sequence).toBe(4);
    const current = await sharedSecurityAudit();
    expect(() => assertSecurityAuditIntegrity(current.file)).not.toThrow();
    expect(current.file.entries.map(({ sequence }) => sequence))
      .toEqual([1, 2, 3, 4]);

    const keys = await inspector.keys(`${prefix}:*`);
    const surface = JSON.stringify({ keys, values: await inspector.mGet(keys) });
    for (const value of [
      privateIdentity,
      actorId(),
      "member.authentication.succeeded",
      "authentication",
      current.file.entries[0]!.integrity,
    ]) expect(surface).not.toContain(value);

    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 22).toString("base64");
    resetSharedStateRedisClientForTests();
    await expect(securityAuditStore.list()).rejects.toThrow();
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 21).toString("base64");

    const serialized = await sharedRecordRepository.get("security-audit");
    expect(serialized).not.toBeNull();
    const recordKey = keys.find((key) => key.endsWith(":value"))!;
    const tampered = JSON.parse(serialized!);
    tampered.tag = `${tampered.tag.startsWith("A") ? "B" : "A"}${tampered.tag.slice(1)}`;
    await inspector.set(recordKey, JSON.stringify(tampered));
    resetSharedStateRedisClientForTests();
    await expect(securityAuditStore.list()).rejects.toThrow();
  });
});
