import { describe, expect, it } from "vitest";

import type { Mailbox, MailboxRole } from "@/domain/mail/mailbox";
import { id } from "@/domain/shared/brand";
import {
  chunkMessageIds,
  messageMoveTargets,
  resolveDraggedMessageIds,
} from "@/presentation/features/mail-workspace/message-move-policy";

const mailbox = (
  mailboxId: string,
  role: MailboxRole,
  options: { readonly add?: boolean; readonly parentId?: string; readonly remove?: boolean } = {},
): Mailbox => ({
  color: "#000000",
  id: id.mailbox(mailboxId),
  name: mailboxId.replaceAll("-", " "),
  parentId: options.parentId ? id.mailbox(options.parentId) : null,
  rights: {
    mayAddItems: options.add ?? true,
    mayCreateChild: true,
    mayDelete: false,
    mayRemoveItems: options.remove ?? true,
    mayRename: false,
  },
  role,
  sortOrder: 0,
  total: 0,
  unread: 0,
});

describe("message move policy", () => {
  it("uses one permission-aware target policy with nested breadcrumbs", () => {
    const targets = messageMoveTargets([
      mailbox("inbox", "inbox"),
      mailbox("sent", "sent"),
      mailbox("drafts", "drafts"),
      mailbox("clients", "custom"),
      mailbox("active", "custom", { parentId: "clients" }),
      mailbox("denied", "custom", { add: false }),
    ], id.mailbox("inbox"));

    expect(targets).toEqual([
      { id: "clients", label: "clients" },
      { id: "active", label: "clients / active" },
    ]);
  });

  it("fails closed when the source cannot remove items", () => {
    expect(messageMoveTargets([
      mailbox("inbox", "inbox", { remove: false }),
      mailbox("archive", "archive"),
    ], id.mailbox("inbox"))).toEqual([]);
  });

  it("moves the selected group only when the dragged row is selected", () => {
    const first = id.message("first");
    const second = id.message("second");
    const selected = new Set([first, second]);

    expect(resolveDraggedMessageIds(first, selected)).toEqual([first, second]);
    expect(resolveDraggedMessageIds(id.message("third"), selected)).toEqual([
      "third",
    ]);
  });

  it("deduplicates and chunks large loaded selections without truncation", () => {
    const ids = Array.from({ length: 205 }, (_, index) =>
      id.message(`message-${index}`));
    const chunks = chunkMessageIds([...ids, ids[0]!]);

    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(chunks.flat()).toEqual(ids);
  });
});
