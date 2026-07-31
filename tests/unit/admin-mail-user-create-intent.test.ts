import { describe, expect, it, vi } from "vitest";

import {
  fingerprintMailboxIntent,
  idempotencyIntent,
  normalizeMailboxEmail,
} from "@/presentation/features/admin-mail-users/admin-mail-user-create-intent";

describe("admin mailbox creation intent", () => {
  it("normalizes only the domain and rejects another selected domain", () => {
    expect(normalizeMailboxEmail(" Ada.User@EXAMPLE.COM ", "example.com")).toBe(
      "Ada.User@example.com",
    );
    expect(normalizeMailboxEmail("ada@other.test", "example.com")).toBeNull();
    expect(normalizeMailboxEmail("bad@local@example.com", "example.com")).toBeNull();
  });

  it("reuses a key only for the same non-secret mailbox intent", async () => {
    const generate = vi
      .fn<() => string>()
      .mockReturnValueOnce("key-one")
      .mockReturnValueOnce("key-two");
    const firstFingerprint = await fingerprintMailboxIntent(
      "Ada@example.com",
      "Ada",
    );
    const changedFingerprint = await fingerprintMailboxIntent(
      "Ada@example.com",
      "Ada L.",
    );
    const first = idempotencyIntent(null, firstFingerprint, generate);
    const retry = idempotencyIntent(first, firstFingerprint, generate);
    const changed = idempotencyIntent(retry, changedFingerprint, generate);

    expect(retry).toBe(first);
    expect(changed.key).toBe("key-two");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(firstFingerprint).not.toContain("Ada@example.com");
  });
});
