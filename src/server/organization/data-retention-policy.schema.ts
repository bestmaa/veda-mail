import "server-only";

import { z } from "zod";

export const dataRetentionPolicySchema = z.object({
  securityAuditMaxAgeDays: z.number().int().min(1).max(3_650),
  securityAuditMaxEntries: z.number().int().min(100).max(10_000),
}).strict();

export const dataRetentionPolicyRecordSchema = z.object({
  policy: dataRetentionPolicySchema,
  updatedAt: z.string().datetime(),
  version: z.literal(1),
}).strict();
