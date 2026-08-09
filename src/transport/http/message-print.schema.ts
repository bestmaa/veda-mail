import { z } from "zod";

export const messagePrintRequestSchema = z
  .object({
    scope: z.enum(["message", "conversation"]),
  })
  .strict();
