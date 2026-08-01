import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { id } from "@/domain/shared/brand";
import {
  decodeMessageListCursor,
  encodeMessageListCursor,
} from "@/server/mail/message-list-cursor";

const secret = "test-secret-that-is-not-used-in-production";
const context = {
  includePreview: true,
  mailboxId: id.mailbox("inbox"),
  search: "quarterly report",
  sort: "newest" as const,
};

const payloadOf = (cursor: string): Record<string, unknown> => {
  const body = cursor.split(".")[0];
  if (!body) throw new Error("Cursor body missing.");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
};

describe("message list cursor", () => {
  it("round-trips a provider cursor only in the exact signed context", () => {
    const cursor = encodeMessageListCursor("50", context, secret, 1_000);
    expect(decodeMessageListCursor(cursor, context, secret, 2_000)).toBe("50");
    for (const changed of [
      { ...context, mailboxId: id.mailbox("archive") },
      { ...context, search: "other" },
      { ...context, sort: "oldest" as const },
      { ...context, includePreview: false },
    ]) {
      expect(() => decodeMessageListCursor(cursor, changed, secret, 2_000))
        .toThrow("page expired");
    }
  });

  it("rejects tampering, a different session secret, and expiry", () => {
    const cursor = encodeMessageListCursor("50", context, secret, 1_000);
    expect(() => decodeMessageListCursor(`${cursor}x`, context, secret, 2_000))
      .toThrow("page expired");
    expect(() => decodeMessageListCursor(cursor, context, "other", 2_000))
      .toThrow("page expired");
    expect(() => decodeMessageListCursor(cursor, context, secret, 1_801_000))
      .toThrow("page expired");
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
  ])("rejects a non-canonical or out-of-range provider cursor %j", (providerCursor) => {
    expect(() => encodeMessageListCursor(providerCursor, context, secret))
      .toThrow();
  });

  it("accepts both provider cursor boundaries", () => {
    for (const providerCursor of ["0", "2147483647"]) {
      const cursor = encodeMessageListCursor(providerCursor, context, secret, 1_000);
      expect(decodeMessageListCursor(cursor, context, secret, 2_000))
        .toBe(providerCursor);
    }
  });

  it("uses a keyed search digest rather than exposing a dictionary-testable SHA-256", () => {
    const cursor = encodeMessageListCursor("50", context, secret, 1_000);
    const otherSecretCursor = encodeMessageListCursor(
      "50",
      context,
      "different-secret",
      1_000,
    );
    const plainDigest = createHash("sha256")
      .update(context.search)
      .digest("base64url");

    expect(payloadOf(cursor)["searchHash"]).not.toBe(plainDigest);
    expect(payloadOf(cursor)["searchHash"])
      .not.toBe(payloadOf(otherSecretCursor)["searchHash"]);
  });

  it.each([
    "",
    "body-only",
    "body.signature.extra",
    `${"x".repeat(2_049)}.signature`,
    "%%%.$$$",
  ])("rejects a malformed or oversized opaque cursor", (cursor) => {
    expect(() => decodeMessageListCursor(cursor, context, secret, 2_000))
      .toThrow("page expired");
  });
});
