import "server-only";

import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  emptySecurityAuditFile,
  type SecurityAuditFile,
  securityAuditFileSchema,
} from "@/server/security-audit/security-audit-record";

const FILE_NAME = "security-audit.json";
export const MAX_SECURITY_AUDIT_FILE_BYTES = 16 * 1024 * 1024;

const dataDirectory = (): string => process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const securityAuditFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

export const readSecurityAuditFile = async (): Promise<SecurityAuditFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ securityAuditFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_SECURITY_AUDIT_FILE_BYTES) {
      throw new Error("The security audit store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_SECURITY_AUDIT_FILE_BYTES) {
      throw new Error("The security audit store exceeds its safe size limit.");
    }
    return securityAuditFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptySecurityAuditFile();
    }
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeSecurityAuditFile = async (
  value: SecurityAuditFile,
): Promise<void> => {
  const parsed = securityAuditFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_SECURITY_AUDIT_FILE_BYTES) {
    throw new Error("The security audit store exceeds its safe size limit.");
  }
  const directory = dataDirectory();
  const temporary = path.join(
    /* turbopackIgnore: true */ directory,
    `.${FILE_NAME}.${crypto.randomUUID()}`,
  );
  await mkdir(/* turbopackIgnore: true */ directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ securityAuditFilePath(),
    );
    await chmod(/* turbopackIgnore: true */ securityAuditFilePath(), 0o600);
    const directoryHandle = await open(/* turbopackIgnore: true */ directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
