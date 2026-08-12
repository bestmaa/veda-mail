import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runBackupRestoreDrill } from "@/../scripts/backup-restore-drill.mjs";

const roots: string[] = [];
const temporary = async (prefix: string) => {
  const value = await mkdtemp(path.join(os.tmpdir(), prefix)); roots.push(value); return value;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("offline backup restore drill", () => {
  it("archives, restores, byte-verifies, and records an evidence report", async () => {
    const source = await temporary("veda-backup-source-");
    const parent = await temporary("veda-backup-output-");
    const work = path.join(parent, "drill");
    await mkdir(path.join(source, "nested"));
    await writeFile(path.join(source, "installation.json"), "installation-state\n", { mode: 0o600 });
    await writeFile(path.join(source, "nested", "member-state.json"), Buffer.from([0, 1, 2, 255]), { mode: 0o600 });

    const report = await runBackupRestoreDrill({ sourceDirectory: source, workDirectory: work });
    expect(report.entryCount).toBe(3); expect(report.byteCount).toBe(23);
    expect(report.archiveSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect((await stat(path.join(work, "veda-mail-data.tar.gz"))).mode & 0o777).toBe(0o600);
    await expect(readFile(path.join(work, "restored-data", "nested", "member-state.json")))
      .resolves.toEqual(Buffer.from([0, 1, 2, 255]));
    expect(JSON.parse(await readFile(path.join(work, "drill-report.json"), "utf8")))
      .toMatchObject({ version: 1, entryCount: 3 });
  });

  it("refuses symlinks and non-empty output directories", async () => {
    const source = await temporary("veda-backup-unsafe-");
    const parent = await temporary("veda-backup-refusal-");
    await writeFile(path.join(source, "state.json"), "state");
    await symlink(path.join(source, "state.json"), path.join(source, "linked.json"));
    await expect(runBackupRestoreDrill({ sourceDirectory: source, workDirectory: path.join(parent, "one") }))
      .rejects.toThrow(/unsupported entry/u);
    const work = path.join(parent, "two"); await mkdir(work); await writeFile(path.join(work, "keep"), "x");
    await rm(path.join(source, "linked.json"));
    await expect(runBackupRestoreDrill({ sourceDirectory: source, workDirectory: work }))
      .rejects.toThrow(/must be empty/u);
  });
});
