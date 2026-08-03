import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from "@/server/mail/conversation-cursor";

const secret = "conversation-test-secret";
const anchor = id.message("provider-message-anchor");
const providerCursor = `25.${"s".repeat(43)}`;

const decodedBody = (cursor: string): string => {
  const body = cursor.split(".")[0];
  if (!body) throw new Error("Cursor body missing.");
  return Buffer.from(body, "base64url").toString("utf8");
};

describe("conversation cursor", () => {
  it("round-trips a snapshot-bound provider cursor for its exact anchor", () => {
    const cursor = encodeConversationCursor(providerCursor, anchor, secret, 1_000);

    expect(decodeConversationCursor(cursor, anchor, secret, 2_000))
      .toBe(providerCursor);
    expect(() => decodeConversationCursor(
      cursor,
      id.message("other-anchor"),
      secret,
      2_000,
    )).toThrow("conversation page expired");
  });

  it("rejects tampering, another connection secret, and 30-minute expiry", () => {
    const cursor = encodeConversationCursor(providerCursor, anchor, secret, 1_000);

    expect(() => decodeConversationCursor(`${cursor}x`, anchor, secret, 2_000))
      .toThrow("conversation page expired");
    expect(() => decodeConversationCursor(cursor, anchor, "other", 2_000))
      .toThrow("conversation page expired");
    expect(() => decodeConversationCursor(cursor, anchor, secret, 1_801_000))
      .toThrow("conversation page expired");
  });

  it.each([
    "",
    "-1",
    "01",
    "1.5",
    "1e2",
    "2147483648",
    "9999999999",
    "10000000000",
    `25.${"s".repeat(42)}`,
    `0.${"s".repeat(43)}`,
  ])("rejects a non-canonical provider cursor %j", (providerCursor) => {
    expect(() => encodeConversationCursor(providerCursor, anchor, secret))
      .toThrow();
  });

  it("does not disclose message, thread, or header identifiers", () => {
    const body = decodedBody(
      encodeConversationCursor(providerCursor, anchor, secret, 1_000),
    );

    expect(body).not.toContain(anchor);
    expect(body).not.toContain("thread");
    expect(body).not.toContain("message-id");
    expect(body).not.toContain("references");
    expect(body).not.toContain("in-reply-to");
  });

  it.each([
    "",
    "body-only",
    "body.signature.extra",
    `${"x".repeat(2_049)}.signature`,
    "%%%.$$$",
  ])("rejects malformed or oversized input %j", (cursor) => {
    expect(() => decodeConversationCursor(cursor, anchor, secret, 2_000))
      .toThrow("conversation page expired");
  });
});
