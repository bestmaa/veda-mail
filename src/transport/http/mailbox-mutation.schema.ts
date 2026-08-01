import { MAILBOX_COLORS } from "@/domain/mail/mailbox";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import { hasUnpairedContentSurrogate } from "@/domain/mail/outgoing-content-policy";
import { id } from "@/domain/shared/brand";
import { z } from "zod";

const mailboxIdSchema = z
  .string()
  .min(1)
  .max(2_048)
  .transform(id.mailbox);

const mailboxNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a mailbox name.")
  .max(255, "Mailbox names cannot exceed 255 characters.")
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= 255,
    "Mailbox names cannot exceed 255 UTF-8 bytes.",
  )
  .refine(
    (value) => !hasHeaderControlCharacter(value),
    "Mailbox names cannot contain control characters.",
  )
  .refine(
    (value) => !hasUnpairedContentSurrogate(value),
    "Mailbox names contain invalid text.",
  );

const colorSchema = z.enum(MAILBOX_COLORS);

export const createMailboxSchema = z
  .object({
    color: colorSchema,
    name: mailboxNameSchema,
    parentId: mailboxIdSchema.nullable().default(null),
  })
  .strict();

export const updateMailboxSchema = z
  .object({
    color: colorSchema.optional(),
    mailboxId: mailboxIdSchema,
    name: mailboxNameSchema.optional(),
    parentId: mailboxIdSchema.nullable().optional(),
  })
  .strict()
  .refine(
    ({ color, name, parentId }) =>
      color !== undefined || name !== undefined || parentId !== undefined,
    "Choose at least one mailbox change.",
  );

export const deleteMailboxSchema = z
  .object({ mailboxId: mailboxIdSchema })
  .strict();
