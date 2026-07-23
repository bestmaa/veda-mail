import "server-only";

import {
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { InstallationRecord } from "@/domain/installation/installation";
import { installationRecordSchema } from "@/server/installation/installation.schema";
import { ApiError } from "@/transport/http/api-error";

const DATA_FILE = "installation.json";

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

const installationPath = (): string => path.join(dataDirectory(), DATA_FILE);

const writeTemporary = async (
  installation: InstallationRecord,
): Promise<string> => {
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${DATA_FILE}.${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await writeFile(temporary, `${JSON.stringify(installation, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return temporary;
};

export const readInstallation = async (): Promise<InstallationRecord | null> => {
  try {
    const contents = await readFile(installationPath(), "utf8");
    return installationRecordSchema.parse(JSON.parse(contents));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const createInstallation = async (
  installation: InstallationRecord,
): Promise<void> => {
  const temporary = await writeTemporary(installation);
  try {
    await link(temporary, installationPath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ApiError(
        "First-run setup has already been completed.",
        "SETUP_ALREADY_COMPLETED",
        409,
      );
    }
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
};

export const writeInstallation = async (
  installation: InstallationRecord,
): Promise<void> => {
  const temporary = await writeTemporary(installation);
  try {
    await rename(temporary, installationPath());
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};
