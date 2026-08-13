import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type MemberSecurityFile,
  memberSecurityFileSchema,
} from "@/server/auth/member-two-factor-record";

const FILE_NAME = "member-security.json";
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const dataDirectory = () => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");
export const memberSecurityFilePath = () =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);
const emptyFile = (): MemberSecurityFile => ({
  members: {}, updatedAt: new Date(0).toISOString(), version: 1,
});

export const readMemberSecurityFile = async (): Promise<MemberSecurityFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ memberSecurityFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_FILE_BYTES) throw new Error("Member security file is too large.");
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_FILE_BYTES) throw new Error("Member security file is too large.");
    return memberSecurityFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally { await handle?.close(); }
};

export const writeMemberSecurityFile = async (
  value: MemberSecurityFile,
): Promise<void> => {
  const parsed = memberSecurityFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_FILE_BYTES) {
    throw new Error("Member security file is too large.");
  }
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${FILE_NAME}.${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, memberSecurityFilePath());
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

export const archiveMigratedMemberSecurityFile = async (): Promise<void> => {
  try {
    await rename(
      memberSecurityFilePath(), `${memberSecurityFilePath()}.migrated-to-redis`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
