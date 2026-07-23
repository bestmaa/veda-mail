import "server-only";

import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { ApiError } from "@/transport/http/api-error";

const LOCK_FILE = ".setup.lock";
const STALE_AFTER_MS = 5 * 60 * 1000;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

const lockPath = (): string => path.join(dataDirectory(), LOCK_FILE);

const removeStaleLock = async (): Promise<boolean> => {
  try {
    const details = await stat(lockPath());
    if (Date.now() - details.mtimeMs < STALE_AFTER_MS) {
      return false;
    }
    const abandoned = `${lockPath()}.${crypto.randomUUID()}.abandoned`;
    await rename(lockPath(), abandoned);
    await unlink(abandoned).catch(() => undefined);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }
};

const acquire = async (): Promise<() => Promise<void>> => {
  await mkdir(dataDirectory(), { mode: 0o700, recursive: true });
  const owner = randomBytes(32).toString("base64url");
  try {
    await writeFile(lockPath(), owner, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST" &&
      (await removeStaleLock())
    ) {
      return acquire();
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ApiError(
        "Another first-run setup is already in progress.",
        "SETUP_IN_PROGRESS",
        409,
      );
    }
    throw error;
  }
  return async () => {
    const current = await readFile(lockPath(), "utf8").catch(() => "");
    if (current === owner) {
      await unlink(lockPath()).catch(() => undefined);
    }
  };
};

export const withSetupLock = async <T>(
  task: () => Promise<T>,
): Promise<T> => {
  const release = await acquire();
  try {
    return await task();
  } finally {
    await release();
  }
};
