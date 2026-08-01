import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import { MESSAGE_LIST_SORTS } from "@/domain/mail/message-list-preferences";
import type { MailboxId } from "@/domain/shared/brand";
import { installationStore } from "@/server/installation/installation.store";
import { ApiError } from "@/transport/http/api-error";

const CURSOR_TTL_MS = 30 * 60_000;
const MAX_CURSOR_CHARACTERS = 2_048;
const MAX_PROVIDER_CURSOR = 2_147_483_647;
const providerCursorSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,9})$/u)
  .refine((value) => Number(value) <= MAX_PROVIDER_CURSOR);
const cursorPayloadSchema = z.object({
  expiresAt: z.number().int().positive(),
  includePreview: z.boolean(),
  limit: z.literal(50),
  mailboxId: z.string().min(1).max(2_048),
  providerCursor: providerCursorSchema,
  searchHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  sort: z.enum(MESSAGE_LIST_SORTS),
  version: z.literal(1),
}).strict();

interface CursorContext {
  readonly includePreview: boolean;
  readonly mailboxId: MailboxId;
  readonly search?: string;
  readonly sort: (typeof MESSAGE_LIST_SORTS)[number];
}

const searchHash = (search: string | undefined, secret: string): string =>
  createHmac("sha256", secret)
  .update("veda-mail/message-list-cursor/search/v1\0")
  .update(search ?? "")
  .digest("base64url");

const signature = (body: string, secret: string): Buffer => createHmac(
  "sha256", secret,
).update("veda-mail/message-list-cursor/v1\0").update(body).digest();

const expired = (): never => {
  throw new ApiError(
    "This mailbox page expired. Refresh the mailbox and try again.",
    "MESSAGE_LIST_CURSOR_EXPIRED",
    409,
  );
};

export const messageListCursorSecret = async (
  connectionId: string,
): Promise<string> => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError(
      "Mailbox pagination is unavailable.",
      "MESSAGE_LIST_CURSOR_UNAVAILABLE",
      500,
    );
  }
  return createHmac("sha256", installation.sessionSecret)
    .update("veda-mail/message-list-cursor/secret/v1\0")
    .update(connectionId)
    .digest("base64url");
};

export const encodeMessageListCursor = (
  providerCursor: string,
  context: CursorContext,
  secret: string,
  now = Date.now(),
): string => {
  const payload = cursorPayloadSchema.parse({
    expiresAt: now + CURSOR_TTL_MS,
    includePreview: context.includePreview,
    limit: 50,
    mailboxId: context.mailboxId,
    providerCursor,
    searchHash: searchHash(context.search, secret),
    sort: context.sort,
    version: 1,
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body, secret).toString("base64url")}`;
};

export const decodeMessageListCursor = (
  cursor: string,
  context: CursorContext,
  secret: string,
  now = Date.now(),
): string => {
  try {
    if (cursor.length > MAX_CURSOR_CHARACTERS) return expired();
    const [body, encodedSignature, extra] = cursor.split(".");
    if (!body || !encodedSignature || extra) return expired();
    const supplied = Buffer.from(encodedSignature, "base64url");
    const expected = signature(body, secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return expired();
    }
    const payload = cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (
      payload.expiresAt <= now ||
      payload.mailboxId !== context.mailboxId ||
      payload.searchHash !== searchHash(context.search, secret) ||
      payload.sort !== context.sort ||
      payload.includePreview !== context.includePreview
    ) return expired();
    return payload.providerCursor;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return expired();
  }
};
