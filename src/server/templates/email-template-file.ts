import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type EmailTemplateFile,
  emailTemplateFileSchema,
} from "@/server/templates/email-template-record";

const FILE_NAME = "member-templates.json";
export const MAX_EMAIL_TEMPLATE_FILE_BYTES = 64 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const emailTemplateFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

const emptyFile = (): EmailTemplateFile => ({
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readEmailTemplateFile = async (): Promise<EmailTemplateFile> => {
  let handle;
  try {
    handle = await open(
      /* turbopackIgnore: true */ emailTemplateFilePath(),
      "r",
    );
    const fileStats = await handle.stat();
    if (fileStats.size > MAX_EMAIL_TEMPLATE_FILE_BYTES) {
      throw new Error("The template store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_EMAIL_TEMPLATE_FILE_BYTES) {
      throw new Error("The template store exceeds its safe size limit.");
    }
    return emailTemplateFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeEmailTemplateFile = async (
  value: EmailTemplateFile,
): Promise<void> => {
  const parsed = emailTemplateFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_EMAIL_TEMPLATE_FILE_BYTES) {
    throw new Error("The template store exceeds its safe size limit.");
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
      /* turbopackIgnore: true */ emailTemplateFilePath(),
    );
    try {
      const directoryHandle = await open(
        /* turbopackIgnore: true */ directory,
        "r",
      );
      await directoryHandle.sync().catch(() => undefined);
      await directoryHandle.close().catch(() => undefined);
    } catch {
      // The atomic rename is committed; directory fsync is best effort.
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};

export const archiveMigratedEmailTemplateFile = async (): Promise<void> => {
  try {
    await rename(
      /* turbopackIgnore: true */ emailTemplateFilePath(),
      /* turbopackIgnore: true */ `${emailTemplateFilePath()}.migrated-to-redis`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};
