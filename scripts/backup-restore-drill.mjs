import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, mkdir, lstat, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const MAX_FILES = 20_000;
const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileDigest = async (file) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
const portable = (value) => value.split(path.sep).join("/");

export const backupManifest = async (root) => {
  const entries = [];
  let bytes = 0;
  const visit = async (relative) => {
    const absolute = path.join(root, relative);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`Backup source contains an unsupported entry: ${portable(relative)}`);
    }
    if (relative) entries.push({
      mode: metadata.mode & 0o777,
      path: portable(relative),
      size: metadata.isFile() ? metadata.size : 0,
      type: metadata.isFile() ? "file" : "directory",
      ...(metadata.isFile() ? { sha256: await fileDigest(absolute) } : {}),
    });
    if (entries.length > MAX_FILES) throw new Error("Backup source exceeds 20,000 entries.");
    if (metadata.isFile()) {
      bytes += metadata.size;
      if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES) {
        throw new Error("Backup source exceeds the 4 GiB drill limit.");
      }
      return;
    }
    const children = await readdir(absolute);
    children.sort((left, right) => left.localeCompare(right, "en"));
    for (const child of children) await visit(path.join(relative, child));
  };
  await visit("");
  return { bytes, entries };
};

const sameManifest = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

export const runBackupRestoreDrill = async ({ sourceDirectory, workDirectory }) => {
  const source = await realpath(sourceDirectory);
  const requestedWork = path.resolve(workDirectory);
  await mkdir(requestedWork, { mode: 0o700, recursive: true });
  if ((await lstat(requestedWork)).isSymbolicLink()) {
    throw new Error("Drill output cannot be a symbolic link.");
  }
  const work = await realpath(requestedWork);
  if (source === work || work.startsWith(`${source}${path.sep}`)) {
    throw new Error("Drill output must be outside the backup source.");
  }
  if ((await readdir(work)).length !== 0) {
    throw new Error("Drill output directory must be empty.");
  }
  const before = await backupManifest(source);
  const archive = path.join(work, "veda-mail-data.tar.gz");
  const restored = path.join(work, "restored-data");
  await execute("tar", ["-czf", archive, "--format=posix", "--numeric-owner",
    "--owner=0", "--group=0", "-C", source, "."], { maxBuffer: 1024 * 1024 });
  await chmod(archive, 0o600);
  await mkdir(restored, { mode: 0o700 });
  await execute("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions",
    "-C", restored], { maxBuffer: 1024 * 1024 });
  const after = await backupManifest(restored);
  if (!sameManifest(before, after)) {
    throw new Error("Restored data does not match the source manifest.");
  }
  const report = {
    archive: path.basename(archive),
    archiveSha256: await fileDigest(archive),
    byteCount: before.bytes,
    completedAt: new Date().toISOString(),
    entryCount: before.entries.length,
    manifestSha256: digest(Buffer.from(JSON.stringify(before), "utf8")),
    restoredDirectory: path.basename(restored),
    version: 1,
  };
  await writeFile(path.join(work, "drill-report.json"), `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  return report;
};

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    values.set(process.argv[index], process.argv[index + 1]);
  }
  const sourceDirectory = values.get("--source");
  const workDirectory = values.get("--work-dir");
  if (!sourceDirectory || !workDirectory || values.size !== 2) {
    throw new Error("Usage: npm run backup:drill -- --source <offline-data-copy> --work-dir <empty-output-directory>");
  }
  console.log(JSON.stringify(await runBackupRestoreDrill({ sourceDirectory, workDirectory }), null, 2));
}
