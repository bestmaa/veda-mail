import { describe, expect, it } from "vitest";

import {
  mailUserDetail,
  mailUserListItem,
} from "@/presentation/features/admin-mail-users/admin-mail-users.formatters";

describe("admin mailbox user formatters", () => {
  it("formats safe quota and optional profile values", () => {
    const item = mailUserListItem(
      {
        aliases: [],
        createdAt: null,
        displayName: null,
        email: "member@example.com",
        id: "member",
        maxDiskQuota: 10 * 1024,
        usedDiskQuota: 1024,
      },
    );
    const detail = mailUserDetail({
      aliases: [],
      createdAt: null,
      displayName: null,
      email: "member@example.com",
      id: "member",
      locale: null,
      maxDiskQuota: null,
      timeZone: null,
      usedDiskQuota: 0,
    });

    expect(item).toMatchObject({
      createdLabel: "Not reported",
      displayName: "Unnamed mailbox",
      storageLabel: "1.0 KiB of 10 KiB",
    });
    expect(detail).toMatchObject({
      locale: "Not set",
      storageLabel: "0 B used",
      timeZone: "Not set",
    });
  });
});
