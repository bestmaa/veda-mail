import { describe, expect, it } from "vitest";

import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";
import { RECOVERY_TOMBSTONE_RETENTION_MS } from "@/presentation/features/mail-workspace/composer-recovery-database-upgrade";

describe("composer recovery database policy", () => {
  it("retains revocations beyond the maximum valid member session", () => {
    expect(RECOVERY_TOMBSTONE_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(RECOVERY_TOMBSTONE_RETENTION_MS).toBeGreaterThan(
      MEMBER_CONNECTION_TTL_MS,
    );
  });
});

