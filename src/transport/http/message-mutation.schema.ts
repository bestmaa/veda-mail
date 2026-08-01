import { z } from "zod";

import { id } from "@/domain/shared/brand";

const messageIdSchema = z.string().min(1).max(2_048).transform(id.message);
const mailboxIdSchema = z.string().min(1).max(2_048).transform(id.mailbox);

export const messageMutationSchema = z.discriminatedUnion("type", [
  z.object({
    messageId: messageIdSchema,
    type: z.enum(["archive", "delete", "restore"]),
  }).strict(),
  z.object({
    messageId: messageIdSchema,
    type: z.enum(["set-read", "set-starred"]),
    value: z.boolean(),
  }).strict(),
  z.object({
    labelId: z.string().regex(/^veda-label-[a-z2-7]{26}$/u).transform(id.label),
    messageId: messageIdSchema,
    type: z.literal("set-label"),
    value: z.boolean(),
  }).strict(),
  z.object({
    destinationMailboxId: mailboxIdSchema,
    messageId: messageIdSchema,
    sourceMailboxId: mailboxIdSchema,
    type: z.literal("move"),
  }).strict(),
]);
