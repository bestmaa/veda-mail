import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_SESSION_IDLE_TTL_SECONDS,
  adminSessionStore,
} from "@/server/auth/admin-session-store";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-06T10:00:00.000Z"));
  adminSessionStore.clearAll();
});

afterEach(() => {
  adminSessionStore.clearAll();
  vi.useRealTimers();
});

describe("administrator session registry", () => {
  it("expires a session at its idle deadline even before absolute expiry", () => {
    adminSessionStore.create({
      authVersion: 4,
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
      id: "session-a",
    });

    vi.advanceTimersByTime(ADMIN_SESSION_IDLE_TTL_SECONDS * 1_000 - 1);
    expect(adminSessionStore.get("session-a", 4, false)).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(adminSessionStore.get("session-a", 4)).toBeNull();
  });

  it("touches activity without extending the absolute deadline", () => {
    const absoluteExpiry = Date.now() + 45 * 60 * 1_000;
    adminSessionStore.create({
      authVersion: 4,
      expiresAt: absoluteExpiry,
      id: "session-a",
    });

    vi.advanceTimersByTime(20 * 60 * 1_000);
    expect(adminSessionStore.get("session-a", 4)?.lastSeenAt).toBe(
      "2026-08-06T10:20:00.000Z",
    );
    vi.advanceTimersByTime(25 * 60 * 1_000);
    expect(adminSessionStore.get("session-a", 4)).toBeNull();
  });

  it("revokes selectively and prunes sessions from older auth versions", () => {
    const expiresAt = Date.now() + 60 * 60 * 1_000;
    adminSessionStore.create({ authVersion: 3, expiresAt, id: "old" });
    adminSessionStore.create({ authVersion: 4, expiresAt, id: "current" });
    adminSessionStore.create({ authVersion: 4, expiresAt, id: "other" });

    expect(adminSessionStore.remove("other")).toBe(true);
    expect(adminSessionStore.list(4).map(({ id }) => id)).toEqual(["current"]);
    expect(adminSessionStore.get("old", 3)).toBeNull();
  });
});
