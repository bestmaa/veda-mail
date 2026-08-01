import { id } from "@/domain/shared/brand";
import { z } from "zod";

export const emptyMailboxSchema = z.object({
  mailboxId: z.string().min(1).max(2_048).transform(id.mailbox),
}).strict();
