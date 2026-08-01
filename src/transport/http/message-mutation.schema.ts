import { z } from "zod";

import { id } from "@/domain/shared/brand";

export const messageMutationSchema = z.discriminatedUnion("type", [
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["archive", "delete", "restore"]),
  }).strict(),
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["set-read", "set-starred"]),
    value: z.boolean(),
  }).strict(),
  z.object({
    labelId: z.string().regex(/^veda-label-[a-z2-7]{26}$/u).transform(id.label),
    messageId: z.string().transform(id.message),
    type: z.literal("set-label"),
    value: z.boolean(),
  }).strict(),
  z.object({
    mailboxId: z.string().transform(id.mailbox),
    messageId: z.string().transform(id.message),
    type: z.literal("move"),
  }).strict(),
]);
