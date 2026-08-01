import "server-only";

import { z } from "zod";

import { messageListPreferencesSchema } from "@/transport/http/message-list-preferences.schema";

export const storedMessageListPreferencesSchema = z
  .object({
    preferences: messageListPreferencesSchema,
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

const encryptedRecordSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().min(1).max(4_096),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict();

export const messageListPreferencesFileSchema = z
  .object({
    owners: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      encryptedRecordSchema,
    ),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .refine((file) => Object.keys(file.owners).length <= 10_000);

export type StoredMessageListPreferences = z.infer<
  typeof storedMessageListPreferencesSchema
>;
export type MessageListPreferencesFile = z.infer<
  typeof messageListPreferencesFileSchema
>;
export type EncryptedMessageListPreferences =
  MessageListPreferencesFile["owners"][string];
