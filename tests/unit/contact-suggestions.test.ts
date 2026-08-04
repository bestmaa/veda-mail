import type { ContactBook } from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import {
  contactSuggestions,
  recipientSuggestionQuery,
} from "@/presentation/features/mail-workspace/contact-suggestions";
import { describe, expect, it } from "vitest";

const book: ContactBook = {
  contacts: [{
    createdAt: "2026-08-04T00:00:00.000Z",
    emails: [{ email: "ada@example.com", label: "work" }],
    id: id.contact("00000000-0000-4000-8000-000000000001"),
    name: "Ada Lovelace",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  createdAt: "2026-08-04T00:00:00.000Z",
  groups: [{
    contactIds: [id.contact("00000000-0000-4000-8000-000000000001")],
    createdAt: "2026-08-04T00:00:00.000Z",
    id: id.contactGroup("00000000-0000-4000-8000-000000000002"),
    name: "Engineering",
    updatedAt: "2026-08-04T00:00:00.000Z",
    version: 1,
  }],
  recents: [{
    email: "grace@example.com",
    lastUsedAt: "2026-08-04T00:00:00.000Z",
    name: "Grace Hopper",
    useCount: 2,
  }],
  revision: "revision-0000000000000001",
  updatedAt: "2026-08-04T00:00:00.000Z",
  version: 1,
};

describe("contact suggestions", () => {
  it("finds the active recipient token without splitting quoted commas", () => {
    expect(recipientSuggestionQuery('"Doe, Jane" <jane@example.com>, ada')).toBe("ada");
  });

  it("distinguishes contacts, groups, and recents", () => {
    expect(contactSuggestions(book, "", 10).map(({ kind }) => kind)).toEqual([
      "contact",
      "group",
      "recent",
    ]);
  });

  it("expands a group and preserves earlier recipient tokens", () => {
    const suggestion = contactSuggestions(book, "first@example.com, eng", 10)
      .find(({ kind }) => kind === "group");
    expect(suggestion?.description).toBe("1 member");
    expect(suggestion?.replacement).toBe(
      'first@example.com, "Ada Lovelace" <ada@example.com>',
    );
  });

  it("does not duplicate recent addresses already saved as contacts", () => {
    const duplicateBook = {
      ...book,
      recents: [{ ...book.recents[0]!, email: "ADA@example.com" }],
    };
    expect(contactSuggestions(duplicateBook, "ada", 10)).toHaveLength(1);
  });
});
