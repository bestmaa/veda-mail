import { describe, expect, it } from "vitest";

import {
  hasMailboxSearch,
  resolveMailSearchScope,
} from "@/application/services/mail-search-scope";
import type { Mailbox } from "@/domain/mail/mail";
import { parseMailSearch } from "@/domain/mail/mail-search-parser";
import { id } from "@/domain/shared/brand";

const mailbox = (name: string, role: Mailbox["role"], value: string): Mailbox => ({
  color: "#4f46e5",
  id: id.mailbox(value),
  name,
  parentId: null,
  rights: {
    mayCreateChild: false,
    mayDelete: false,
    mayRename: false,
  },
  role,
  sortOrder: 0,
  total: 0,
  unread: 0,
});

const mailboxes = [
  mailbox("Inbox", "inbox", "inbox-id"),
  mailbox("Project Alpha", "custom", "project-id"),
];

describe("mail search mailbox scope", () => {
  it("resolves role and strips the mailbox predicate before provider search", () => {
    const search = parseMailSearch("in:inbox from:ada@example.com");

    expect(hasMailboxSearch(search)).toBe(true);
    expect(resolveMailSearchScope(mailboxes, search)).toEqual({
      mailboxId: "inbox-id",
      providerSearch: {
        canonical: "from:ada@example.com",
        criteria: [{ field: "from", type: "text", value: "ada@example.com" }],
      },
    });
  });

  it("supports a quoted custom mailbox as the complete search", () => {
    expect(resolveMailSearchScope(
      mailboxes,
      parseMailSearch('in:"project alpha"'),
    )).toEqual({ mailboxId: "project-id" });
  });

  it("prefers a standard role over a colliding custom name", () => {
    expect(resolveMailSearchScope(
      [...mailboxes, mailbox("Inbox", "custom", "custom-inbox")],
      parseMailSearch("in:inbox"),
    )).toEqual({ mailboxId: "inbox-id" });
  });

  it("rejects unknown and ambiguous mailbox names", () => {
    expect(() => resolveMailSearchScope(
      mailboxes,
      parseMailSearch("in:missing"),
    )).toThrow("not found");
    expect(() => resolveMailSearchScope(
      [...mailboxes, mailbox("Project Alpha", "custom", "duplicate-id")],
      parseMailSearch('in:"project alpha"'),
    )).toThrow("ambiguous");
  });
});
