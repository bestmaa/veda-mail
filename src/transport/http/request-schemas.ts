import { id } from "@/domain/shared/brand";
import { z } from "zod";

const addressSchema = z.object({
  email: z.string().email(),
  name: z.string().nullable(),
});

export const connectionRequestSchema = z.object({
  config: z.record(z.string(), z.string()),
  displayName: z.string().trim().min(2).max(80),
  providerId: z.string().trim().min(1).transform(id.provider),
});

export const sendMessageSchema = z.object({
  bcc: z.array(addressSchema).default([]),
  body: z.string().trim().min(1).max(1_000_000),
  cc: z.array(addressSchema).default([]),
  inReplyTo: z.string().transform(id.message).optional(),
  subject: z.string().trim().max(998),
  to: z.array(addressSchema).min(1),
});

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
