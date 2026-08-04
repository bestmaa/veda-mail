import { describe, expect, it } from "vitest";

import {
  MAX_RECENT_RECIPIENTS,
  type ContactInput,
} from "@/domain/member/contact";
import { id } from "@/domain/shared/brand";
import {
  addRecentRecipients,
  updateContactBook,
} from "@/server/contacts/contact-book";
import { rankRecentRecipients } from "@/server/contacts/contact-ranking";
import { emptyContactBook } from "@/server/contacts/contact-record";

const now = "2026-08-04T10:00:00.000Z";
const contact = (name: string, email: string): ContactInput => ({
  emails: [{ email, label: "Work" }],
  name,
});

describe("contact book mutations", () => {
  it("creates contacts and groups and cascades deleted group members", () => {
    const first = updateContactBook(emptyContactBook(), {
      contact: contact("Ada", "ada@example.com"),
      expectedRevision: null,
      operation: "create-contact",
    }, now);
    const second = updateContactBook(first, {
      contact: contact("Grace", "grace@example.com"),
      expectedRevision: first.revision,
      operation: "create-contact",
    }, now);
    const grouped = updateContactBook(second, {
      expectedRevision: second.revision,
      group: {
        contactIds: second.contacts.map(({ id: contactId }) => contactId),
        name: "Engineering",
      },
      operation: "create-group",
    }, now);
    const deleted = updateContactBook(grouped, {
      contactId: grouped.contacts[0]!.id,
      expectedRevision: grouped.revision,
      operation: "delete-contact",
    }, now);

    expect(deleted.contacts).toHaveLength(1);
    expect(deleted.groups[0]?.contactIds).toEqual([deleted.contacts[0]?.id]);
  });

  it("preflights an entire import and rejects duplicates atomically", () => {
    const base = updateContactBook(emptyContactBook(), {
      contact: contact("Existing", "existing@example.com"),
      expectedRevision: null,
      operation: "create-contact",
    }, now);
    expect(() => updateContactBook(base, {
      contacts: [
        contact("New", "new@example.com"),
        contact("Duplicate", "EXISTING@example.com"),
      ],
      expectedRevision: base.revision,
      operation: "import-contacts",
    }, now)).toThrow(expect.objectContaining({
      code: "CONTACT_IMPORT_EMAIL_CONFLICT",
    }));
    expect(base.contacts).toHaveLength(1);
  });

  it("creates index-bound import groups in the same book revision", () => {
    const imported = updateContactBook(emptyContactBook(), {
      contacts: [
        contact("Ada", "ada@example.com"),
        contact("Grace", "grace@example.com"),
      ],
      expectedRevision: null,
      groups: [{ contactIndexes: [1, 0], name: "Pioneers" }],
      operation: "import-contacts",
    }, now);
    expect(imported.groups).toHaveLength(1);
    expect(imported.groups[0]?.contactIds).toEqual([
      imported.contacts[1]?.id,
      imported.contacts[0]?.id,
    ]);
    expect(() => updateContactBook(imported, {
      contacts: [contact("New", "new@example.com")],
      expectedRevision: imported.revision,
      groups: [{ contactIndexes: [1], name: "Broken" }],
      operation: "import-contacts",
    }, now)).toThrow(expect.objectContaining({
      code: "CONTACT_IMPORT_GROUP_MEMBER_NOT_FOUND",
    }));
  });

  it("rejects missing group members and duplicate contact addresses", () => {
    const base = updateContactBook(emptyContactBook(), {
      contact: contact("Ada", "ada@example.com"),
      expectedRevision: null,
      operation: "create-contact",
    }, now);
    expect(() => updateContactBook(base, {
      contact: contact("Duplicate", "ADA@example.com"),
      expectedRevision: base.revision,
      operation: "create-contact",
    }, now)).toThrow(expect.objectContaining({ code: "CONTACT_EMAIL_CONFLICT" }));
    expect(() => updateContactBook(base, {
      expectedRevision: base.revision,
      group: { contactIds: [id.contact(crypto.randomUUID())], name: "Missing" },
      operation: "create-group",
    }, now)).toThrow(expect.objectContaining({
      code: "CONTACT_GROUP_MEMBER_NOT_FOUND",
    }));
  });
});

describe("recent recipient ranking", () => {
  it("deduplicates a batch, caps storage, and ranks deterministically", () => {
    const inputs = Array.from({ length: MAX_RECENT_RECIPIENTS + 20 }, (_, index) => ({
      email: `person-${index}@example.com`,
      name: `Person ${index}`,
    }));
    let book = addRecentRecipients(emptyContactBook(), [
      ...inputs.slice(0, 99),
      { email: "PERSON-0@example.com", name: "Updated" },
    ], now);
    for (let offset = 99; offset < inputs.length; offset += 100) {
      book = addRecentRecipients(book, inputs.slice(offset, offset + 100), now);
    }
    expect(book.recents).toHaveLength(MAX_RECENT_RECIPIENTS);
    expect(book.recents.filter(({ email }) =>
      email.toLowerCase() === "person-0@example.com")).toHaveLength(1);

    const ranked = rankRecentRecipients([
      { email: "z@example.com", lastUsedAt: now, name: "Alpha", useCount: 1 },
      { email: "a@example.com", lastUsedAt: now, name: "Alpine", useCount: 2 },
    ], "al", 10);
    expect(ranked.map(({ email }) => email)).toEqual([
      "a@example.com",
      "z@example.com",
    ]);
  });
});
