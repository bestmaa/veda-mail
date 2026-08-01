import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { MailboxEmptyCursorError } from "@/domain/mail/mailbox-empty";

const envelopeSchema = z.object({
  body: z.string().min(1).max(4_096).regex(/^[A-Za-z0-9_-]+$/u),
  mac: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u),
}).strict();
const context = "veda-mail-mailbox-empty-cursor-v1\0";

const signature = (body: string, secret: string): Buffer => createHmac(
  "sha256", secret,
).update(context).update(body).digest();

export const encodeMailboxEmptyCursor = (
  payload: unknown,
  secret: string,
): string => {
  if (secret.length === 0) throw new Error("Mailbox empty cursor secret is invalid.");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return Buffer.from(JSON.stringify({
    body,
    mac: signature(body, secret).toString("base64url"),
  }), "utf8").toString("base64url");
};

export const decodeMailboxEmptyCursor = (
  cursor: string,
  secret: string,
): unknown => {
  try {
    if (secret.length === 0) throw new Error("secret");
    const envelope = envelopeSchema.parse(JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ));
    const provided = Buffer.from(envelope.mac, "base64url");
    const expected = signature(envelope.body, secret);
    if (
      provided.byteLength !== expected.byteLength ||
      !timingSafeEqual(provided, expected) ||
      Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url") !== cursor
    ) {
      throw new Error("signature");
    }
    return JSON.parse(Buffer.from(envelope.body, "base64url").toString("utf8"));
  } catch {
    throw new MailboxEmptyCursorError();
  }
};
