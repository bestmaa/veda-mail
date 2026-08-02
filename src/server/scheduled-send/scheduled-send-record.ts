import "server-only";

import { z } from "zod";

import {
  MAX_SCHEDULED_MESSAGE_OWNERS,
  MAX_SCHEDULED_MESSAGES_PER_OWNER,
} from "@/domain/mail/scheduled-send";
import { sendMessageSchema } from "@/transport/http/request-schemas";

const scheduledRequestSchema = sendMessageSchema
  .refine((request) => request.attachmentIds.length === 0)
  .refine((request) => Boolean(request.providerDraftId))
  .transform((request) => ({
    bcc: request.bcc,
    body: request.body,
    cc: request.cc,
    draftId: request.draftId,
    expectedDraftRevision: request.expectedDraftRevision!,
    ...(request.htmlBody ? { htmlBody: request.htmlBody } : {}),
    ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
    providerDraftId: request.providerDraftId!,
    subject: request.subject,
    to: request.to,
  }));

const connectionSchema = z
  .object({
    config: z.record(z.string().min(1).max(100), z.string().max(16 * 1024)),
    createdAt: z.string().datetime(),
    displayName: z.string().min(1).max(80),
    id: z.string().uuid(),
    providerId: z.string().min(1).max(100),
  })
  .strict()
  .refine((connection) => Object.keys(connection.config).length <= 64)
  .refine((connection) =>
    Buffer.byteLength(JSON.stringify(connection.config), "utf8") <= 128 * 1024);

export const scheduledJobSchema = z
  .object({
    attemptCount: z.number().int().min(0).max(6),
    connection: connectionSchema,
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    lastError: z.string().max(200).nullable(),
    leaseId: z.string().min(32).max(100).nullable(),
    nextAttemptAt: z.string().datetime(),
    purpose: z.enum(["scheduled", "undo"]).default("scheduled"),
    request: scheduledRequestSchema,
    scheduledAt: z.string().datetime(),
    state: z.enum(["failed", "pending", "retrying", "sending", "uncertain"]),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();

export const scheduledJobBookSchema = z
  .object({
    jobs: z.array(scheduledJobSchema).max(MAX_SCHEDULED_MESSAGES_PER_OWNER),
    revision: z.string().min(16).max(200),
    version: z.literal(1),
  })
  .strict();

const encryptedBookSchema = z
  .object({
    algorithm: z.literal("aes-256-gcm"),
    ciphertext: z.string().min(1).max(64 * 1024 * 1024),
    iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict();

export const scheduledJobFileSchema = z
  .object({
    keyCheck: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    owners: z.record(
      z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
      encryptedBookSchema,
    ),
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict()
  .refine(
    (file) => Object.keys(file.owners).length <= MAX_SCHEDULED_MESSAGE_OWNERS,
  );

export type ScheduledJob = z.infer<typeof scheduledJobSchema>;
export type ScheduledJobBook = z.infer<typeof scheduledJobBookSchema>;
export type ScheduledJobFile = z.infer<typeof scheduledJobFileSchema>;
export type EncryptedScheduledJobBook = ScheduledJobFile["owners"][string];
