import { describe, expect, it } from "vitest";

import {
  connectionExpiresAt,
  connectionExpiresAtMs,
  MEMBER_CONNECTION_TTL_MS,
  MEMBER_CONNECTION_TTL_SECONDS,
} from "@/server/connections/connection-lifetime";

describe("mail connection lifetime", () => {
  it("derives one absolute expiry for browser and server enforcement", () => {
    const connection = { createdAt: "2026-07-31T10:00:00.000Z" };

    expect(MEMBER_CONNECTION_TTL_SECONDS).toBe(12 * 60 * 60);
    expect(connectionExpiresAtMs(connection)).toBe(
      Date.parse(connection.createdAt) + MEMBER_CONNECTION_TTL_MS,
    );
    expect(connectionExpiresAt(connection)).toBe(
      "2026-07-31T22:00:00.000Z",
    );
  });

  it("fails closed for an invalid connection creation time", () => {
    expect(() => connectionExpiresAt({ createdAt: "not-a-date" })).toThrow(
      "Mail connection creation time is invalid.",
    );
  });

  it("fails closed when the derived expiry exceeds the Date range", () => {
    expect(() =>
      connectionExpiresAt({ createdAt: "+275760-09-12T23:59:59.999Z" }),
    ).toThrow("Mail connection expiry time is invalid.");
  });
});
