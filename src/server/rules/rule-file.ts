import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type RuleFile,
  ruleFileSchema,
} from "@/server/rules/rule-record";

const FILE_NAME = "member-rules.json";
export const MAX_RULE_FILE_BYTES = 64 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const ruleFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

export const emptyRuleFile = (): RuleFile => ({
  keyCheck: null,
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readRuleFile = async (): Promise<RuleFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ ruleFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_RULE_FILE_BYTES) {
      throw new Error("The rules store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_RULE_FILE_BYTES) {
      throw new Error("The rules store exceeds its safe size limit.");
    }
    return ruleFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyRuleFile();
    }
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeRuleFile = async (value: RuleFile): Promise<void> => {
  const parsed = ruleFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_RULE_FILE_BYTES) {
    throw new Error("The rules store exceeds its safe size limit.");
  }
  const directory = dataDirectory();
  const temporary = path.join(
    /* turbopackIgnore: true */ directory,
    `.${FILE_NAME}.${crypto.randomUUID()}`,
  );
  await mkdir(/* turbopackIgnore: true */ directory, {
    mode: 0o700,
    recursive: true,
  });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ ruleFilePath(),
    );
    try {
      const directoryHandle = await open(
        /* turbopackIgnore: true */ directory,
        "r",
      );
      await directoryHandle.sync().catch(() => undefined);
      await directoryHandle.close().catch(() => undefined);
    } catch {
      // Atomic replacement is committed; directory fsync is best effort.
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
