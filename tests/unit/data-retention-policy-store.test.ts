import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dataRetentionPolicyStore } from "@/server/organization/data-retention-policy.store";

const originalDirectory = process.env["VEDA_MAIL_DATA_DIR"];
let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "veda-retention-"));
  process.env["VEDA_MAIL_DATA_DIR"] = directory;
});
afterEach(async () => {
  if (originalDirectory === undefined) delete process.env["VEDA_MAIL_DATA_DIR"];
  else process.env["VEDA_MAIL_DATA_DIR"] = originalDirectory;
  await rm(directory, { force: true, recursive: true });
});

describe("data retention policy store", () => {
  it("uses conservative compatibility defaults without creating state", async () => {
    await expect(dataRetentionPolicyStore.get()).resolves.toEqual({
      securityAuditMaxAgeDays: 365,
      securityAuditMaxEntries: 10_000,
    });
    await expect(readFile(path.join(directory, "data-retention-policy.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes a strict atomic mode-0600 record", async () => {
    const policy = { securityAuditMaxAgeDays: 90, securityAuditMaxEntries: 2_000 };
    await dataRetentionPolicyStore.put(policy);
    const target = path.join(directory, "data-retention-policy.json");
    const record = JSON.parse(await readFile(target, "utf8"));
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect(record).toMatchObject({ policy, version: 1 });
    await expect(dataRetentionPolicyStore.get()).resolves.toEqual(policy);
  });

  it("fails closed on unknown persisted fields", async () => {
    await writeFile(path.join(directory, "data-retention-policy.json"), JSON.stringify({
      policy: { securityAuditMaxAgeDays: 30, securityAuditMaxEntries: 100, unknown: true },
      updatedAt: new Date().toISOString(), version: 1,
    }));
    await expect(dataRetentionPolicyStore.get()).rejects.toThrow();
  });
});
