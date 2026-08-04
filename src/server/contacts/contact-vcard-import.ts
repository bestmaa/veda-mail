import "server-only";

import {
  contactNameKey,
  MAX_CONTACT_EMAILS,
  type ContactImportGroupInput,
  type ContactInput,
  type ContactOwner,
} from "@/domain/member/contact";
import { contactStore } from "@/server/contacts/contact-store";
import {
  importVCards,
  VCARD_LIMITS,
  type VCardContact,
} from "@/server/contacts/contact-vcard";
import { ApiError } from "@/transport/http/api-error";
import { z } from "zod";

export const MAX_VCARD_IMPORT_REQUEST_BYTES =
  VCARD_LIMITS.inputBytes * 2 + 64 * 1024;

const importSchema = z.object({
  expectedRevision: z.string().trim().min(16).max(200).nullable(),
  vcard: z.string().min(1),
}).strict();

const contactInput = (card: VCardContact): ContactInput => {
  if (card.emails.length > MAX_CONTACT_EMAILS) {
    throw new ApiError(
      `A vCard can contain at most ${MAX_CONTACT_EMAILS} email addresses.`,
      "CONTACT_IMPORT_EMAIL_LIMIT",
      422,
    );
  }
  return {
    emails: card.emails.map((email) => ({
      email: email.address,
      label: email.types[0] ?? (email.preferred ? "preferred" : null),
    })),
    name: card.displayName,
  };
};

const importGroups = (
  cards: readonly VCardContact[],
): readonly ContactImportGroupInput[] => {
  const groups = new Map<string, { name: string; indexes: Set<number> }>();
  cards.forEach((card, contactIndex) => {
    for (const category of card.categories) {
      const key = contactNameKey(category);
      const group = groups.get(key) ?? { name: category, indexes: new Set() };
      group.indexes.add(contactIndex);
      groups.set(key, group);
    }
  });
  return [...groups.values()].map((group) => ({
    contactIndexes: [...group.indexes],
    name: group.name,
  }));
};

export const importContactVCards = async (
  owner: ContactOwner,
  value: unknown,
) => {
  const payload = importSchema.parse(value);
  const cards = importVCards(payload.vcard);
  const groups = importGroups(cards);
  return contactStore.put(owner, {
    contacts: cards.map(contactInput),
    expectedRevision: payload.expectedRevision,
    ...(groups.length ? { groups } : {}),
    operation: "import-contacts",
  });
};
