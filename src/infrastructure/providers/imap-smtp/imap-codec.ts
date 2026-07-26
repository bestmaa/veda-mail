import "server-only";

import { z } from "zod";

import type { ImapMessageReference } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const referenceSchema = z
  .object({
    mailbox: z.string().min(1).max(1024),
    uid: z.number().int().positive(),
  })
  .strict();

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decode = (value: string): unknown =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

export const encodeMailboxId = (mailbox: string): string =>
  encode({ mailbox });

export const decodeMailboxId = (value: string): string =>
  z.object({ mailbox: z.string().min(1).max(1024) }).parse(decode(value)).mailbox;

export const encodeMessageId = (reference: ImapMessageReference): string =>
  encode(reference);

export const decodeMessageId = (value: string): ImapMessageReference =>
  referenceSchema.parse(decode(value));
