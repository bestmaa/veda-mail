import { describe, expect, it } from "vitest";

import {
  createMailboxSchema,
  updateMailboxSchema,
} from "@/transport/http/mailbox-mutation.schema";

describe("mailbox mutation request schemas", () => {
  it("canonicalizes valid create input and rejects style injection", () => {
    expect(createMailboxSchema.parse({
      color: "#a855f7",
      name: "  Projects  ",
      parentId: null,
    })).toMatchObject({ name: "Projects" });
    expect(createMailboxSchema.safeParse({
      color: "red; background:url(https://attacker.example)",
      name: "Projects",
      parentId: null,
    }).success).toBe(false);
  });

  it("requires a bounded change and rejects control characters", () => {
    expect(updateMailboxSchema.safeParse({ mailboxId: "folder" }).success).toBe(false);
    expect(updateMailboxSchema.safeParse({
      mailboxId: "folder",
      name: "bad\nname",
    }).success).toBe(false);
    expect(updateMailboxSchema.safeParse({
      color: "#64748b",
      mailboxId: "folder",
    }).success).toBe(true);
  });
});
