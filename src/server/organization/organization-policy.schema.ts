import "server-only";

import { z } from "zod";

export const organizationFeaturePolicySchema = z
  .object({
    memberPasswordChange: z.boolean(),
    memberProfileEditing: z.boolean(),
    memberTwoFactorEnrollment: z.boolean(),
  })
  .strict();

export const organizationPolicyRecordSchema = z
  .object({
    policy: organizationFeaturePolicySchema,
    updatedAt: z.string().datetime(),
    version: z.literal(1),
  })
  .strict();
