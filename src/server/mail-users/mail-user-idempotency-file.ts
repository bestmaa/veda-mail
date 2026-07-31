import "server-only";

import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { MailUserIdempotencyLedger } from "@/server/mail-users/mail-user-idempotency.types";

const FILE_NAME = "mail-user-provisioning-idempotency.json";
export const MAX_MAIL_USER_IDEMPOTENCY_FILE_BYTES = 2 * 1024 * 1024;

const userSchema = z
  .object({
    aliases: z.array(z.string().max(320)).max(100),
    createdAt: z.string().datetime({ offset: true }).nullable(),
    displayName: z.string().max(512).nullable(),
    email: z.string().email().max(320),
    id: z.string().min(1).max(512),
    locale: z.string().max(64).nullable(),
    maxDiskQuota: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    timeZone: z.string().max(128).nullable(),
    usedDiskQuota: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const resultSchema = z
  .object({
    outcome: z.literal("created"),
    user: userSchema,
    warning: z.literal("cache-invalidation-failed").optional(),
  })
  .strict();

const base = {
  createdAt: z.string().datetime(),
  expiresAt: z.number().int().positive(),
  fingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
};

const entrySchema = z.discriminatedUnion("state", [
  z.object({ ...base, state: z.literal("pending") }).strict(),
  z.object({ ...base, result: resultSchema, state: z.literal("completed") }).strict(),
]);

const ledgerSchema = z
  .object({
    entries: z.record(z.string().uuid(), entrySchema),
    version: z.literal(1),
  })
  .strict();

const dataDirectory = (): string =>
  process.env["VEDA_MAIL_DATA_DIR"] ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const mailUserIdempotencyFilePath = (): string =>
  path.join(/* turbopackIgnore: true */ dataDirectory(), FILE_NAME);

export const readMailUserIdempotencyLedger =
  async (): Promise<MailUserIdempotencyLedger> => {
    let handle;
    try {
      handle = await open(
        /* turbopackIgnore: true */ mailUserIdempotencyFilePath(),
        "r",
      );
      const stats = await handle.stat();
      if (stats.size > MAX_MAIL_USER_IDEMPOTENCY_FILE_BYTES) {
        throw new Error("The mailbox provisioning ledger exceeds its safe size limit.");
      }
      const contents = await handle.readFile();
      if (contents.byteLength > MAX_MAIL_USER_IDEMPOTENCY_FILE_BYTES) {
        throw new Error("The mailbox provisioning ledger exceeds its safe size limit.");
      }
      return ledgerSchema.parse(
        JSON.parse(contents.toString("utf8")),
      ) as MailUserIdempotencyLedger;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { entries: {}, version: 1 };
      }
      throw error;
    } finally {
      await handle?.close();
    }
  };

export const writeMailUserIdempotencyLedger = async (
  ledger: MailUserIdempotencyLedger,
): Promise<void> => {
  const parsed = ledgerSchema.parse(ledger);
  const contents = `${JSON.stringify(parsed)}\n`;
  if (Buffer.byteLength(contents) > MAX_MAIL_USER_IDEMPOTENCY_FILE_BYTES) {
    throw new Error("The mailbox provisioning ledger exceeds its safe size limit.");
  }
  const directory = dataDirectory();
  const temporary = path.join(directory, `.${FILE_NAME}.${crypto.randomUUID()}`);
  await mkdir(directory, { mode: 0o700, recursive: true });
  let handle;
  try {
    handle = await open(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(
      /* turbopackIgnore: true */ temporary,
      /* turbopackIgnore: true */ mailUserIdempotencyFilePath(),
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
