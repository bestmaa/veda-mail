import { describe, expect, it } from "vitest";

import {
  adminMailUsersSnapshotForDomain,
  bindAdminMailUsersSnapshot,
} from "@/presentation/features/admin-mail-users/admin-mail-users-snapshot";
import type { AdminMailUsersSnapshot } from "@/transport/client/admin-mail-users-api";

const snapshot: AdminMailUsersSnapshot = {
  adminTwoFactorEnabled: false,
  allowedDomains: ["old.example", "new.example"],
  creation: { available: true, reason: null },
  nextCursor: null,
  status: "available",
  users: [
    {
      aliases: [],
      createdAt: null,
      displayName: "Old account",
      email: "old@old.example",
      id: "old-account",
      maxDiskQuota: null,
      usedDiskQuota: 0,
    },
  ],
};

describe("admin mailbox snapshot domain ownership", () => {
  it("exposes a snapshot only under the domain that produced it", () => {
    const bound = bindAdminMailUsersSnapshot("old.example", snapshot);

    expect(adminMailUsersSnapshotForDomain(bound, "old.example")).toBe(snapshot);
    expect(adminMailUsersSnapshotForDomain(bound, "new.example")).toBeNull();
    expect(adminMailUsersSnapshotForDomain(null, "old.example")).toBeNull();
  });
});
