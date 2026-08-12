import "server-only";

import { MAILBOX_COLORS } from "@/domain/mail/mailbox";
import { z } from "zod";

const mailboxColorSchema = z.enum(MAILBOX_COLORS);
const mailboxIdSchema = z.string().min(1).max(2_048);

export const storedMailboxAppearanceBookSchema = z
  .object({
    colors: z.record(mailboxIdSchema, mailboxColorSchema),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .refine((book) => Object.keys(book.colors).length <= 512);

export const encryptedMailboxAppearanceBookSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().min(1).max(2 * 1_024 * 1_024),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict();

export const mailboxAppearanceFileSchema = z
  .object({
    owners: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      encryptedMailboxAppearanceBookSchema,
    ),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export type StoredMailboxAppearanceBook = z.infer<
  typeof storedMailboxAppearanceBookSchema
>;
export type MailboxAppearanceFile = z.infer<typeof mailboxAppearanceFileSchema>;
export type EncryptedMailboxAppearanceBook =
  MailboxAppearanceFile["owners"][string];

export const emptyMailboxAppearanceBook = (): StoredMailboxAppearanceBook => ({
  colors: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});
