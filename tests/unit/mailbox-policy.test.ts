import { describe, expect, it } from "vitest";

import type { Mailbox, MailboxRole } from "@/domain/mail/mail";
import {
  assertMailboxMutation,
  MailboxPolicyError,
} from "@/domain/mail/mailbox-policy";
import { id, type MailboxId } from "@/domain/shared/brand";

const mailbox = (
  value: string,
  parentId: MailboxId | null = null,
  overrides: Partial<Mailbox> = {},
): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name: value,
  parentId,
  role: "custom" as MailboxRole,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  sortOrder: 0,
  total: 0,
  unread: 0,
  ...overrides,
});

const failure = (task: () => void): MailboxPolicyError => {
  try {
    task();
  } catch (error) {
    if (error instanceof MailboxPolicyError) return error;
    throw error;
  }
  throw new Error("Expected a mailbox policy failure.");
};

describe("mailbox mutation policy", () => {
  it("accepts unique creates and safe hierarchy moves", () => {
    const parent = mailbox("Projects");
    const child = mailbox("Client A", parent.id);
    expect(() => assertMailboxMutation([parent, child], {
      mailboxId: child.id,
      name: "Client B",
      parentId: null,
      type: "update",
    })).not.toThrow();
    expect(() => assertMailboxMutation([parent, child], {
      name: "Client B",
      parentId: parent.id,
      type: "create",
    })).not.toThrow();
  });

  it("rejects normalized sibling conflicts and hierarchy cycles", () => {
    const parent = mailbox("Projects");
    const child = mailbox("Client A", parent.id);
    expect(failure(() => assertMailboxMutation([parent, child], {
      name: "Ｃｌｉｅｎｔ Ａ",
      parentId: parent.id,
      type: "create",
    })).failure).toBe("conflict");
    expect(failure(() => assertMailboxMutation([parent, child], {
      mailboxId: parent.id,
      parentId: child.id,
      type: "update",
    })).failure).toBe("cycle");
  });

  it("protects system, non-empty, and parent mailboxes from deletion", () => {
    const system = mailbox("Inbox", null, {
      role: "inbox",
      rights: { mayCreateChild: true, mayDelete: false, mayRename: false },
    });
    const parent = mailbox("Projects");
    const child = mailbox("Client", parent.id);
    const nonEmpty = mailbox("Receipts", null, { total: 1 });
    expect(failure(() => assertMailboxMutation([system], {
      mailboxId: system.id, type: "delete",
    })).failure).toBe("forbidden");
    expect(failure(() => assertMailboxMutation([nonEmpty], {
      mailboxId: nonEmpty.id, type: "delete",
    })).failure).toBe("mail-exists");
    expect(failure(() => assertMailboxMutation([parent, child], {
      mailboxId: parent.id, type: "delete",
    })).failure).toBe("child-exists");
  });

  it("bounds names by canonical text and UTF-8 bytes", () => {
    expect(failure(() => assertMailboxMutation([], {
      name: " bad ", parentId: null, type: "create",
    })).failure).toBe("name");
    expect(failure(() => assertMailboxMutation([], {
      name: "é".repeat(128), parentId: null, type: "create",
    })).failure).toBe("name");
  });
});
