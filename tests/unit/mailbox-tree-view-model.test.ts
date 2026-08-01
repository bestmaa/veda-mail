import { describe, expect, it } from "vitest";

import type { Mailbox } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { flattenMailboxTree } from "@/presentation/features/mail-workspace/mailbox-tree.view-model";

const item = (
  value: string,
  parentId: string | null,
  role: Mailbox["role"] = "custom",
): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name: value,
  parentId: parentId ? id.mailbox(parentId) : null,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  role,
  sortOrder: 0,
  total: 0,
  unread: 0,
});

describe("mailbox tree view model", () => {
  it("orders system roots and flattens children with bounded indentation", () => {
    const tree = flattenMailboxTree([
      item("Child", "Projects"),
      item("Sent", null, "sent"),
      item("Projects", null),
      item("Inbox", null, "inbox"),
    ]);
    expect(tree.map(({ depth, mailbox }) => [mailbox.name, depth])).toEqual([
      ["Inbox", 0],
      ["Sent", 0],
      ["Projects", 0],
      ["Child", 1],
    ]);
  });

  it("renders malformed cycles once instead of recursing forever", () => {
    const result = flattenMailboxTree([item("A", "B"), item("B", "A")]);
    expect(result.map(({ mailbox }) => mailbox.name).sort()).toEqual(["A", "B"]);
  });
});
