import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { sharedBrandLogoStore } from
  "@/server/branding/shared-brand-logo-store";
import { ApiError } from "@/transport/http/api-error";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_NAME_PATTERN = /^branding\/logo(?:-[a-f0-9]{64})?\.webp$/;

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

const logoPath = (fileName: string): string => {
  if (!LOGO_NAME_PATTERN.test(fileName)) {
    throw new ApiError("Invalid logo reference.", "INVALID_LOGO", 500);
  }
  return path.join(
    /* turbopackIgnore: true */
    dataDirectory(),
    fileName,
  );
};

export const brandLogoFileName = (contents: Buffer): string =>
  `branding/logo-${createHash("sha256").update(contents).digest("hex")}.webp`;

export const normalizeLogoUpload = async (
  value: FormDataEntryValue | null,
): Promise<Buffer | undefined> => {
  if (!(value instanceof File) || value.size === 0) {
    return undefined;
  }
  if (value.size > MAX_LOGO_BYTES) {
    throw new ApiError(
      "Logo must be 2 MB or smaller.",
      "LOGO_TOO_LARGE",
      400,
    );
  }
  const input = Buffer.from(await value.arrayBuffer());
  try {
    const image = sharp(input, { failOn: "warning", limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new Error("Unsupported image format.");
    }
    return await image
      .rotate()
      .resize({
        fit: "inside",
        height: 512,
        width: 512,
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
  } catch {
    throw new ApiError(
      "Upload a valid PNG, JPEG, or WebP logo.",
      "INVALID_LOGO",
      400,
    );
  }
};

const writeLocalBrandLogo = async (
  fileName: string,
  contents: Buffer,
): Promise<void> => {
  const destination = logoPath(fileName);
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.logo.${crypto.randomUUID()}.webp`);
  await mkdir(/* turbopackIgnore: true */ directory, {
    mode: 0o700,
    recursive: true,
  });
  try {
    await writeFile(/* turbopackIgnore: true */ temporary, contents, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ destination,
    ).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") {
          throw error;
        }
      },
    );
  } catch (error) {
    await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
    throw error;
  }
  await unlink(/* turbopackIgnore: true */ temporary).catch(() => undefined);
};

const readLocalBrandLogo = async (
  fileName: string,
): Promise<Buffer | null> => {
  const source = logoPath(fileName);
  try {
    return await readFile(/* turbopackIgnore: true */ source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const removeLocalBrandLogo = async (fileName: string): Promise<void> => {
  const source = logoPath(fileName);
  await unlink(
    /* turbopackIgnore: true */ source,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
};

const archiveLocalBrandLogo = async (fileName: string): Promise<void> => {
  try {
    await rename(
      /* turbopackIgnore: true */ logoPath(fileName),
      /* turbopackIgnore: true */ `${logoPath(fileName)}.migrated-to-redis`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

export const writeBrandLogo = async (contents: Buffer): Promise<string> => {
  const fileName = brandLogoFileName(contents);
  if (sharedBrandLogoStore.configured()) {
    await sharedBrandLogoStore.put(fileName, contents);
  } else {
    await writeLocalBrandLogo(fileName, contents);
  }
  return fileName;
};

export const readBrandLogo = async (
  fileName: string,
): Promise<Buffer | null> => {
  logoPath(fileName);
  if (!sharedBrandLogoStore.configured()) return readLocalBrandLogo(fileName);
  const shared = await sharedBrandLogoStore.get(fileName);
  if (shared) return shared;
  const local = await readLocalBrandLogo(fileName);
  if (!local) return null;
  await sharedBrandLogoStore.put(fileName, local);
  await archiveLocalBrandLogo(fileName);
  return local;
};

export const removeBrandLogo = async (fileName: string): Promise<void> => {
  logoPath(fileName);
  if (sharedBrandLogoStore.configured()) {
    await sharedBrandLogoStore.remove(fileName);
  }
  await removeLocalBrandLogo(fileName);
};
