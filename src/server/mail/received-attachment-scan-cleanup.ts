import "server-only";

import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const RECEIVED_SCAN_DIRECTORY_PREFIX = "veda-mail-received-scan-";

export const createReceivedAttachmentScanDirectory = async (
  root = os.tmpdir(),
): Promise<string> => {
  const directory = await mkdtemp(path.join(
    root,
    `${RECEIVED_SCAN_DIRECTORY_PREFIX}${process.pid}-`,
  ));
  await chmod(directory, 0o700);
  return directory;
};

const ownerPid = (name: string): number | null => {
  const match = new RegExp(
    `^${RECEIVED_SCAN_DIRECTORY_PREFIX}(\\d+)-`,
    "u",
  ).exec(name);
  if (!match?.[1]) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
};

export const cleanupReceivedAttachmentScanOrphans = async (
  root = os.tmpdir(),
  options: {
    readonly maxDirectories?: number;
    readonly minimumAgeMs?: number;
    readonly now?: () => number;
  } = {},
): Promise<number> => {
  const maximum = options.maxDirectories ?? 128;
  const minimumAge = options.minimumAgeMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || minimumAge < 0) {
    return 0;
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (removed >= maximum) break;
    if (!entry.isDirectory() || !entry.name.startsWith(
      RECEIVED_SCAN_DIRECTORY_PREFIX,
    )) continue;
    const pid = ownerPid(entry.name);
    if (pid === null || processIsAlive(pid)) continue;
    const directory = path.join(root, entry.name);
    const details = await stat(directory).catch(() => null);
    if (details === null || now() - details.mtimeMs < minimumAge) continue;
    try {
      await rm(directory, { force: true, recursive: true });
      removed += 1;
    } catch {
      // A concurrent process may own or already remove this candidate.
    }
  }
  return removed;
};
