import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

import {
  type ContactFile,
  contactFileSchema,
} from "@/server/contacts/contact-record";

const FILE_NAME = "member-contacts.json";
export const MAX_CONTACT_FILE_BYTES = 64 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const contactFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

const emptyFile = (): ContactFile => ({
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readContactFile = async (): Promise<ContactFile> => {
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ contactFilePath(), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_CONTACT_FILE_BYTES) {
      throw new Error("The contact store exceeds its safe size limit.");
    }
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_CONTACT_FILE_BYTES) {
      throw new Error("The contact store exceeds its safe size limit.");
    }
    return contactFileSchema.parse(JSON.parse(contents.toString("utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyFile();
    throw error;
  } finally {
    await handle?.close();
  }
};

export const writeContactFile = async (value: ContactFile): Promise<void> => {
  const parsed = contactFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_CONTACT_FILE_BYTES) {
    throw new Error("The contact store exceeds its safe size limit.");
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
      /* turbopackIgnore: true */ contactFilePath(),
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
