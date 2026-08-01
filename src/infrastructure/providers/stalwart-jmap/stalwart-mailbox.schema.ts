import "server-only";

import { z } from "zod";

export const jmapMailboxSchema = z
  .object({
    id: z.string().min(1).max(2_048),
    myRights: z
      .object({
        mayCreateChild: z.boolean(),
        mayDelete: z.boolean(),
        mayRemoveItems: z.boolean().optional(),
        mayRename: z.boolean(),
        maySetKeywords: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    name: z.string().max(4_096),
    parentId: z.string().min(1).max(2_048).nullable().optional(),
    role: z.string().nullable().optional(),
    sortOrder: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    totalEmails: z.number().int().nonnegative(),
    unreadEmails: z.number().int().nonnegative(),
  })
  .passthrough();
