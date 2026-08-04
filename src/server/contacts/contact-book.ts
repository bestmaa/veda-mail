import "server-only";
import {
  type Contact,
  type ContactBook,
  contactEmailKey,
  type ContactGroup,
  type ContactGroupInput,
  type ContactInput,
  type ContactPutOperation,
  MAX_CONTACT_GROUPS,
  MAX_CONTACT_IMPORT,
  MAX_CONTACTS,
} from "@/domain/member/contact";
import { id, type ContactGroupId, type ContactId } from "@/domain/shared/brand";
import { parseStoredContactBook, type StoredContactBook } from "@/server/contacts/contact-record";
import { ApiError } from "@/transport/http/api-error";
export { addRecentRecipients } from "@/server/contacts/contact-ranking";
const contactNotFound = (): never =>
  { throw new ApiError("The contact was not found.", "CONTACT_NOT_FOUND", 404); };
const groupNotFound = (): never =>
  { throw new ApiError("The contact group was not found.", "CONTACT_GROUP_NOT_FOUND", 404); };
const contactIndex = (book: ContactBook, contactId: ContactId): number => {
  const index = book.contacts.findIndex(({ id: value }) => value === contactId);
  return index < 0 ? contactNotFound() : index;
};
const groupIndex = (book: ContactBook, groupId: ContactGroupId): number => {
  const index = book.groups.findIndex(({ id: value }) => value === groupId);
  return index < 0 ? groupNotFound() : index;
};
const assertUniqueEmails = (
  book: ContactBook,
  input: ContactInput,
  excluding?: ContactId,
): void => {
  const existing = new Set(
    book.contacts
      .filter(({ id: value }) => value !== excluding)
      .flatMap(({ emails }) => emails.map(({ email }) => contactEmailKey(email))),
  );
  if (input.emails.some(({ email }) => existing.has(contactEmailKey(email)))) {
    throw new ApiError(
      "An email address already belongs to another contact.",
      "CONTACT_EMAIL_CONFLICT",
      422,
    );
  }
};
const assertGroupReferences = (
  book: ContactBook,
  input: ContactGroupInput,
): void => {
  const contacts = new Set(book.contacts.map(({ id: value }) => value));
  if (input.contactIds.some((contactId) => !contacts.has(contactId))) {
    throw new ApiError(
      "A contact group references a missing contact.",
      "CONTACT_GROUP_MEMBER_NOT_FOUND",
      422,
    );
  }
};
const assertUniqueGroupName = (
  book: ContactBook,
  name: string,
  excluding?: ContactGroupId,
): void => {
  const key = name.normalize("NFKC").trim().toLowerCase();
  if (book.groups.some((group) =>
    group.id !== excluding &&
    group.name.normalize("NFKC").trim().toLowerCase() === key)) {
    throw new ApiError(
      "Each contact group must have a unique name.",
      "CONTACT_GROUP_NAME_CONFLICT",
      422,
    );
  }
};
const createContact = (input: ContactInput, now: string): Contact => ({
  ...input,
  createdAt: now,
  id: id.contact(crypto.randomUUID()),
  updatedAt: now,
  version: 1,
});
const createGroup = (input: ContactGroupInput, now: string): ContactGroup => ({
  ...input,
  createdAt: now,
  id: id.contactGroup(crypto.randomUUID()),
  updatedAt: now,
  version: 1,
});

const finalize = (
  current: ContactBook,
  values: Pick<ContactBook, "contacts" | "groups" | "recents">,
  now: string,
): StoredContactBook => parseStoredContactBook({
  ...values,
  createdAt: current.createdAt ?? now,
  revision: crypto.randomUUID(),
  updatedAt: now,
  version: 1,
});

export const updateContactBook = (
  current: ContactBook,
  operation: ContactPutOperation,
  now = new Date().toISOString(),
): StoredContactBook => {
  let contacts = [...current.contacts];
  let groups = [...current.groups];
  let recents = [...current.recents];
  if (operation.operation === "import-contacts") {
    if (operation.contacts.length < 1 ||
        operation.contacts.length > MAX_CONTACT_IMPORT) {
      throw new ApiError(
        `Import between 1 and ${MAX_CONTACT_IMPORT} contacts at a time.`,
        "CONTACT_IMPORT_LIMIT_REACHED",
        422,
      );
    }
    if (contacts.length + operation.contacts.length > MAX_CONTACTS) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_CONTACTS} contacts.`,
        "CONTACT_LIMIT_REACHED",
        422,
      );
    }
    const existingEmails = new Set(
      contacts.flatMap(({ emails }) =>
        emails.map(({ email }) => contactEmailKey(email))),
    );
    for (const contact of operation.contacts) {
      for (const { email } of contact.emails) {
        const key = contactEmailKey(email);
        if (existingEmails.has(key)) {
          throw new ApiError(
            "An imported email address already belongs to a contact.",
            "CONTACT_IMPORT_EMAIL_CONFLICT",
            422,
          );
        }
        existingEmails.add(key);
      }
    }
    if (groups.length + (operation.groups?.length ?? 0) > MAX_CONTACT_GROUPS) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_CONTACT_GROUPS} groups.`,
        "CONTACT_GROUP_LIMIT_REACHED",
        422,
      );
    }
    const groupNames = new Set(groups.map(({ name }) =>
      name.normalize("NFKC").trim().toLowerCase()));
    for (const group of operation.groups ?? []) {
      const key = group.name.normalize("NFKC").trim().toLowerCase();
      if (groupNames.has(key)) {
        throw new ApiError(
          "An imported contact group name already exists.",
          "CONTACT_IMPORT_GROUP_NAME_CONFLICT",
          422,
        );
      }
      if (group.contactIndexes.some(
        (contactIndex) => operation.contacts[contactIndex] === undefined)) {
        throw new ApiError(
          "An imported group references a missing batch contact.",
          "CONTACT_IMPORT_GROUP_MEMBER_NOT_FOUND",
          422,
        );
      }
      if (new Set(group.contactIndexes).size !== group.contactIndexes.length) {
        throw new ApiError(
          "An imported group contains a duplicate batch contact.",
          "CONTACT_IMPORT_GROUP_MEMBER_CONFLICT",
          422,
        );
      }
      groupNames.add(key);
    }
    const imported = operation.contacts.map((contact) =>
      createContact(contact, now));
    contacts.push(...imported);
    groups.push(...(operation.groups ?? []).map((group) => createGroup({
      contactIds: group.contactIndexes.map((index) => imported[index]!.id),
      name: group.name,
    }, now)));
  } else if (operation.operation === "create-contact") {
    if (contacts.length >= MAX_CONTACTS) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_CONTACTS} contacts.`,
        "CONTACT_LIMIT_REACHED",
        422,
      );
    }
    assertUniqueEmails(current, operation.contact);
    contacts.push(createContact(operation.contact, now));
  } else if (operation.operation === "update-contact") {
    const index = contactIndex(current, operation.contactId);
    assertUniqueEmails(current, operation.contact, operation.contactId);
    const existing = contacts[index]!;
    contacts[index] = {
      ...operation.contact,
      createdAt: existing.createdAt,
      id: existing.id,
      updatedAt: now,
      version: 1,
    };
  } else if (operation.operation === "delete-contact") {
    contactIndex(current, operation.contactId);
    contacts = contacts.filter(({ id: value }) => value !== operation.contactId);
    groups = groups.flatMap((group) => {
      const contactIds = group.contactIds.filter(
        (contactId) => contactId !== operation.contactId,
      );
      return contactIds.length > 0
        ? [{ ...group, contactIds, updatedAt: now }]
        : [];
    });
  } else if (operation.operation === "create-group") {
    if (groups.length >= MAX_CONTACT_GROUPS) {
      throw new ApiError(
        `Each identity can contain at most ${MAX_CONTACT_GROUPS} groups.`,
        "CONTACT_GROUP_LIMIT_REACHED",
        422,
      );
    }
    assertGroupReferences(current, operation.group);
    assertUniqueGroupName(current, operation.group.name);
    groups.push(createGroup(operation.group, now));
  } else if (operation.operation === "update-group") {
    const index = groupIndex(current, operation.groupId);
    assertGroupReferences(current, operation.group);
    assertUniqueGroupName(current, operation.group.name, operation.groupId);
    const existing = groups[index]!;
    groups[index] = {
      ...operation.group,
      createdAt: existing.createdAt,
      id: existing.id,
      updatedAt: now,
      version: 1,
    };
  } else if (operation.operation === "delete-group") {
    groupIndex(current, operation.groupId);
    groups = groups.filter(({ id: value }) => value !== operation.groupId);
  } else {
    recents = [];
  }
  return finalize(current, { contacts, groups, recents }, now);
};
