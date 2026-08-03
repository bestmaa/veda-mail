import "server-only";

import { z } from "zod";

const emailIdSchema = z.string().min(1).max(1_024);

export const jmapConversationAnchorSchema = z
  .object({
    id: emailIdSchema,
    threadId: z.string().min(1).max(1_024),
  })
  .passthrough();

export const jmapThreadSchema = z
  .object({
    emailIds: z.array(emailIdSchema).max(100_000),
    id: z.string().min(1).max(1_024),
  })
  .passthrough();

export const jmapConversationGetResultSchema = <T extends z.ZodType>(
  itemSchema: T,
  maximumItems: number,
) =>
  z
    .object({
      accountId: z.string().min(1),
      list: z.array(itemSchema).max(maximumItems),
      notFound: z.array(emailIdSchema).max(maximumItems).default([]),
      state: z.string(),
    })
    .passthrough();
