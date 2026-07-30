import "server-only";

import {
  mkdir,
  open,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import {
  type EmailSignatureFile,
  emailSignatureFileSchema,
} from "@/server/signatures/email-signature-record";

const FILE_NAME = "member-signatures.json";
export const MAX_EMAIL_SIGNATURE_FILE_BYTES = 32 * 1024 * 1024;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

export const emailSignatureFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

const emptyFile = (): EmailSignatureFile => ({
  owners: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});

export const readEmailSignatureFile =
  async (): Promise<EmailSignatureFile> => {
    let handle;
    try {
      handle = await open(
        /* turbopackIgnore: true */ emailSignatureFilePath(),
        "r",
      );
      const fileStats = await handle.stat();
      if (fileStats.size > MAX_EMAIL_SIGNATURE_FILE_BYTES) {
        throw new Error("The signature store exceeds its safe size limit.");
      }
      const contents = await handle.readFile();
      if (contents.byteLength > MAX_EMAIL_SIGNATURE_FILE_BYTES) {
        throw new Error("The signature store exceeds its safe size limit.");
      }
      return emailSignatureFileSchema.parse(
        JSON.parse(contents.toString("utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyFile();
      }
      throw error;
    } finally {
      await handle?.close();
    }
  };

export const writeEmailSignatureFile = async (
  value: EmailSignatureFile,
): Promise<void> => {
  const parsed = emailSignatureFileSchema.parse(value);
  const contents = `${JSON.stringify(parsed, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_EMAIL_SIGNATURE_FILE_BYTES) {
    throw new Error("The signature store exceeds its safe size limit.");
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
      /* turbopackIgnore: true */ emailSignatureFilePath(),
    );
    try {
      const directoryHandle = await open(
        /* turbopackIgnore: true */ directory,
        "r",
      );
      await directoryHandle.sync().catch(() => undefined);
      await directoryHandle.close().catch(() => undefined);
    } catch {
      // The atomic rename is already committed; directory fsync is best effort.
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
};
