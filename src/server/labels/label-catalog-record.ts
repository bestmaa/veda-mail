import "server-only";

import { LABEL_COLORS } from "@/domain/mail/label";
import { isCanonicalLabelName } from "@/domain/mail/label-policy";
import { z } from "zod";

const labelIdSchema = z.string().regex(/^veda-label-[a-z2-7]{26}$/u);
const deletionLeaseSchema = z.object({
  expiresAt: z.string().datetime(),
  id: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();
const labelDeletionSchema = z.object({
  cursor: z.string().max(4_096).nullable(),
  emptyChecks: z.number().int().min(0).max(2),
  lease: deletionLeaseSchema.nullable(),
  processed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  removed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
const storedLabelSchema = z.object({
  color: z.enum(LABEL_COLORS),
  createdAt: z.string().datetime(),
  deletion: labelDeletionSchema.optional(),
  name: z.string().min(1).max(100).refine(isCanonicalLabelName),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["active", "deleting"]),
  updatedAt: z.string().datetime(),
}).strict();

export const storedLabelCatalogSchema = z.object({
  labels: z.record(labelIdSchema, storedLabelSchema),
  tombstones: z.record(labelIdSchema, z.string().datetime()),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict().refine((value) => Object.keys(value.labels).length <= 256)
  .refine((value) => Object.keys(value.tombstones).length <= 512);

const encryptedCatalogSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(4 * 1_024 * 1_024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();

export const labelCatalogFileSchema = z.object({
  owners: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    encryptedCatalogSchema,
  ),
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict();

export type StoredLabelCatalog = z.infer<typeof storedLabelCatalogSchema>;
export type StoredLabelDeletion = z.infer<typeof labelDeletionSchema>;
export type LabelCatalogFile = z.infer<typeof labelCatalogFileSchema>;
export type EncryptedLabelCatalog = LabelCatalogFile["owners"][string];

export const emptyLabelCatalog = (): StoredLabelCatalog => ({
  labels: {},
  tombstones: {},
  updatedAt: new Date(0).toISOString(),
  version: 1,
});
