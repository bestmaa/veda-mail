import { z } from "zod";

import { id } from "@/domain/shared/brand";

export const messageMutationSchema = z.discriminatedUnion("type", [
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["archive", "delete", "restore"]),
  }),
  z.object({
    messageId: z.string().transform(id.message),
    type: z.enum(["set-read", "set-starred"]),
    value: z.boolean(),
  }),
  z.object({
    mailboxId: z.string().transform(id.mailbox),
    messageId: z.string().transform(id.message),
    type: z.literal("move"),
  }),
]);
