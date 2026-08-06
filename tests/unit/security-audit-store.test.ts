import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  securityAuditFilePath,
} from "@/server/security-audit/security-audit-file";
import {
  securityAuditSubjectId,
} from "@/server/security-audit/security-audit-key";
import {
  emptySecurityAuditFile,
  type SecurityAuditAppend,
} from "@/server/security-audit/security-audit-record";
import {
  appendSecurityAuditFile,
  securityAuditStore,
} from "@/server/security-audit/security-audit.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
const originalKey = process.env["VEDA_MAIL_JOB_KEY"];
let directory = "";

const event = (actorId: string): SecurityAuditAppend => ({
  action: "member.authentication.succeeded",
  actorId,
  actorType: "member",
  count: null,
  outcome: "success",
  requestId: null,
  targetId: null,
  targetType: "authentication",
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-security-audit-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
  process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 17).toString("base64");
});

afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  if (originalKey === undefined) delete process.env["VEDA_MAIL_JOB_KEY"];
  else process.env["VEDA_MAIL_JOB_KEY"] = originalKey;
  await rm(directory, { force: true, recursive: true });
});

describe("security audit store", () => {
  it("appends an ordered chain, paginates newest-first, and writes mode 0600", async () => {
    const actorId = securityAuditSubjectId("actor", "member:private@example.com");
    await Promise.all(Array.from({ length: 5 }, () => securityAuditStore.append(event(actorId))));

    const [firstPage, metadata] = await Promise.all([
      securityAuditStore.list({ limit: 2 }),
      stat(securityAuditFilePath()),
    ]);
    expect(metadata.mode & 0o777).toBe(0o600);
    expect(firstPage.entries.map(({ sequence }) => sequence)).toEqual([5, 4]);
    expect(firstPage.nextCursor).toBe(4);
    const secondPage = await securityAuditStore.list({
      beforeSequence: firstPage.nextCursor!, limit: 2,
    });
    expect(secondPage.entries.map(({ sequence }) => sequence)).toEqual([3, 2]);
  });

  it("never stores raw actor identities", async () => {
    const privateIdentity = "private-user@example.com";
    await securityAuditStore.append(event(
      securityAuditSubjectId("actor", `member:${privateIdentity}`),
    ));
    const raw = await readFile(securityAuditFilePath(), "utf8");
    expect(raw).not.toContain(privateIdentity);
    expect(raw).not.toContain("stalwart-test");
  });

  it("fails closed after entry or whole-file tampering and truncation", async () => {
    const actorId = securityAuditSubjectId("actor", "member:test");
    await securityAuditStore.append(event(actorId));
    await securityAuditStore.append(event(actorId));
    const original = JSON.parse(await readFile(securityAuditFilePath(), "utf8"));

    await writeFile(securityAuditFilePath(), JSON.stringify({
      ...original,
      entries: original.entries.map((entry: Record<string, unknown>, index: number) =>
        index === 0 ? { ...entry, outcome: "failure" } : entry),
    }), { mode: 0o600 });
    await expect(securityAuditStore.list()).rejects.toThrow(/integrity/u);

    await writeFile(securityAuditFilePath(), JSON.stringify({
      ...original,
      entries: original.entries.slice(0, 1),
    }), { mode: 0o600 });
    await expect(securityAuditStore.list()).rejects.toThrow(/integrity/u);
  });

  it("rejects a valid store when the deployment root key changes", async () => {
    const actorId = securityAuditSubjectId("actor", "member:test");
    await securityAuditStore.append(event(actorId));
    process.env["VEDA_MAIL_JOB_KEY"] = Buffer.alloc(32, 18).toString("base64");
    await expect(securityAuditStore.list()).rejects.toThrow(/key does not match/u);
  });

  it("retains a bounded suffix while preserving chain verification", async () => {
    const actorId = securityAuditSubjectId("actor", "member:test");
    let file = emptySecurityAuditFile();
    for (let index = 0; index < 5; index += 1) {
      file = appendSecurityAuditFile(file, event(actorId), 3);
    }
    await writeFile(securityAuditFilePath(), `${JSON.stringify(file)}\n`, { mode: 0o600 });
    const result = await securityAuditStore.list();
    expect(result.droppedCount).toBe(2);
    expect(result.entries.map(({ sequence }) => sequence)).toEqual([5, 4, 3]);
  });

  it("rejects malformed non-pristine empty stores", async () => {
    await writeFile(securityAuditFilePath(), JSON.stringify({
      ...emptySecurityAuditFile(), droppedCount: 1,
    }), { mode: 0o600 });
    await expect(securityAuditStore.list()).rejects.toThrow(/empty security audit/u);
  });
});
