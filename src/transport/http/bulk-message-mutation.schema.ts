import { z } from "zod";

import { id } from "@/domain/shared/brand";

const messageIdsSchema = z
  .array(z.string().min(1).max(2_048).transform(id.message))
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, {
    message: "Message identifiers must be unique.",
  });

export const bulkMessageMutationSchema = z.discriminatedUnion("type", [
  z
    .object({
      messageIds: messageIdsSchema,
      type: z.enum(["archive", "delete", "restore"]),
    })
    .strict(),
  z
    .object({
      messageIds: messageIdsSchema,
      type: z.enum(["set-read", "set-starred"]),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      labelId: z.string().regex(/^veda-label-[a-z2-7]{26}$/u).transform(id.label),
      messageIds: messageIdsSchema,
      type: z.literal("set-label"),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      mailboxId: z.string().min(1).max(2_048).transform(id.mailbox),
      messageIds: messageIdsSchema,
      type: z.literal("destroy"),
    })
    .strict(),
  z
    .object({
      mailboxId: z.string().min(1).max(2_048).transform(id.mailbox),
      messageIds: messageIdsSchema,
      type: z.literal("move"),
    })
    .strict(),
]);
