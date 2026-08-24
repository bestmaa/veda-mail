import { afterEach, describe, expect, it } from "vitest";

import type { AdminMailUserDetail } from "@/domain/admin/mail-user";
import { mailUserIdempotencyLedgerSchema } from "@/server/mail-users/mail-user-idempotency-file";
import { protectMailUserLifecycle } from "@/server/mail-users/mail-user-lifecycle-protection";

const user = (email: string): AdminMailUserDetail => ({
  aliases: [], createdAt: null, displayName: null, email, id: "account-1",
  lifecycle: { available: true, protected: false, reason: null },
  locale: null, maxDiskQuota: null, timeZone: null, usedDiskQuota: 0,
});

afterEach(() => delete process.env["VEDA_MAIL_PROTECTED_MAILBOXES"]);

describe("mailbox lifecycle safety metadata", () => {
  it.each(["postmaster@example.com", "abuse@example.com"])(
    "automatically protects %s",
    (email) => expect(protectMailUserLifecycle(user(email)).lifecycle)
      .toEqual({ available: false, protected: true, reason: "protected-account" }),
  );

  it("protects configured automation addresses case-insensitively", () => {
    process.env["VEDA_MAIL_PROTECTED_MAILBOXES"] =
      "reports@example.com, AUTOMATION@EXAMPLE.COM";
    expect(protectMailUserLifecycle(user("automation@example.com")).lifecycle?.protected)
      .toBe(true);
    expect(protectMailUserLifecycle(user("member@example.com")).lifecycle?.protected)
      .toBe(false);
  });

  it("persists only the bounded safe lifecycle replay result", () => {
    const key = crypto.randomUUID();
    const parsed = mailUserIdempotencyLedgerSchema.parse({
      entries: {
        [key]: {
          createdAt: "2026-08-24T00:00:00.000Z", expiresAt: Date.now() + 60_000,
          fingerprint: "A".repeat(43), result: {
            email: "ada@example.com", forwardingRemoved: true,
            outcome: "deleted", sessionsRevoked: 2, userId: "account-1",
          }, state: "completed",
        },
      },
      version: 1,
    });
    expect(parsed.entries[key]?.state).toBe("completed");
    expect(() => mailUserIdempotencyLedgerSchema.parse({
      ...parsed,
      entries: { [key]: { ...parsed.entries[key], providerSecret: "forbidden" } },
    })).toThrow();
  });
});
