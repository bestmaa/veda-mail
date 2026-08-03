import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import type { MessageId } from "@/domain/shared/brand";
import { installationStore } from "@/server/installation/installation.store";
import { ApiError } from "@/transport/http/api-error";

const CURSOR_TTL_MS = 30 * 60_000;
const MAX_CURSOR_CHARACTERS = 2_048;
const providerCursorSchema = z
  .string()
  .regex(/^[1-9]\d{0,2}\.[A-Za-z0-9_-]{43}$/u);
const cursorPayloadSchema = z.object({
  anchorHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  expiresAt: z.number().int().positive(),
  limit: z.literal(25),
  providerCursor: providerCursorSchema,
  version: z.literal(1),
}).strict();

const anchorHash = (anchorMessageId: MessageId, secret: string): string =>
  createHmac("sha256", secret)
    .update("veda-mail/conversation-cursor/anchor/v1\0")
    .update(anchorMessageId)
    .digest("base64url");

const signature = (body: string, secret: string): Buffer =>
  createHmac("sha256", secret)
    .update("veda-mail/conversation-cursor/v1\0")
    .update(body)
    .digest();

const expired = (): never => {
  throw new ApiError(
    "This conversation page expired. Reopen the conversation and try again.",
    "CONVERSATION_CURSOR_EXPIRED",
    409,
  );
};

export const conversationCursorSecret = async (
  connectionId: string,
): Promise<string> => {
  const installation = await installationStore.get();
  if (!installation) {
    throw new ApiError(
      "Conversation pagination is unavailable.",
      "CONVERSATION_CURSOR_UNAVAILABLE",
      500,
    );
  }
  return createHmac("sha256", installation.sessionSecret)
    .update("veda-mail/conversation-cursor/secret/v1\0")
    .update(connectionId)
    .digest("base64url");
};

export const encodeConversationCursor = (
  providerCursor: string,
  anchorMessageId: MessageId,
  secret: string,
  now = Date.now(),
): string => {
  const canonicalProviderCursor = providerCursorSchema.parse(providerCursor);
  const payload = cursorPayloadSchema.parse({
    anchorHash: anchorHash(anchorMessageId, secret),
    expiresAt: now + CURSOR_TTL_MS,
    limit: 25,
    providerCursor: canonicalProviderCursor,
    version: 1,
  });
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body, secret).toString("base64url")}`;
};

export const decodeConversationCursor = (
  cursor: string,
  anchorMessageId: MessageId,
  secret: string,
  now = Date.now(),
): string => {
  try {
    if (cursor.length > MAX_CURSOR_CHARACTERS) return expired();
    const [body, encodedSignature, extra] = cursor.split(".");
    if (!body || !encodedSignature || extra) return expired();
    const supplied = Buffer.from(encodedSignature, "base64url");
    const expected = signature(body, secret);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) return expired();
    const payload = cursorPayloadSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (
      payload.expiresAt <= now ||
      payload.anchorHash !== anchorHash(anchorMessageId, secret)
    ) return expired();
    return payload.providerCursor;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return expired();
  }
};
