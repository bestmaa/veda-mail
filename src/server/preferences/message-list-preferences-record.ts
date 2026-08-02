import "server-only";

import { z } from "zod";

import { DEFAULT_MESSAGE_LIST_PREFERENCES } from "@/domain/mail/message-list-preferences";
import { messageListPreferencesSchema } from "@/transport/http/message-list-preferences.schema";

const legacyMessageListPreferencesSchema = z
  .object({
    density: z.enum(["compact", "comfortable", "spacious"]),
    showPreview: z.boolean(),
    sort: z.enum(["newest", "oldest"]),
  })
  .strict();

const legacySendingPreferencesSchema = z
  .object({
    confirmBeforeSend: z.boolean(),
    density: z.enum(["compact", "comfortable", "spacious"]),
    showPreview: z.boolean(),
    sort: z.enum(["newest", "oldest"]),
    undoSendSeconds: z.union([
      z.literal(0), z.literal(5), z.literal(10), z.literal(20), z.literal(30),
    ]),
  })
  .strict();

const storedPreferencesSchema = z
  .union([
    messageListPreferencesSchema,
    legacySendingPreferencesSchema,
    legacyMessageListPreferencesSchema,
  ])
  .transform((preferences) => ({
    ...DEFAULT_MESSAGE_LIST_PREFERENCES,
    ...preferences,
  }));

export const storedMessageListPreferencesSchema = z
  .object({
    preferences: storedPreferencesSchema,
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
