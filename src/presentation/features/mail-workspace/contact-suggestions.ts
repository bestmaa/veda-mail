import {
  contactEmailKey,
  type ContactBook,
} from "@/domain/member/contact";
import { formatAddressInput } from "@/domain/mail/compose";

export interface ContactSuggestion {
  readonly description: string;
  readonly id: string;
  readonly kind: "contact" | "group" | "recent";
  readonly label: string;
  readonly replacement: string;
}

const searchKey = (value: string): string =>
  value.normalize("NFKC").trim().toLowerCase();

const tailStart = (value: string): number => {
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "<") angleDepth += 1;
    else if (!quoted && character === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (!quoted && angleDepth === 0 && character === ",") start = index + 1;
  }
  return start;
};

export const recipientSuggestionQuery = (value: string): string =>
  value.slice(tailStart(value)).trim();

const replaceTail = (value: string, replacement: string): string => {
  const start = tailStart(value);
  const prefix = value.slice(0, start > 0 ? start - 1 : 0).trim();
  return `${prefix ? `${prefix}, ` : ""}${replacement}`;
};

const matchScore = (query: string, values: readonly string[]): number => {
  if (!query) return 1;
  const keys = values.map(searchKey);
  if (keys.some((value) => value.startsWith(query))) return 0;
  return keys.some((value) => value.includes(query)) ? 1 : 2;
};

const compareSuggestions = (
  left: ContactSuggestion & { readonly score: number },
  right: ContactSuggestion & { readonly score: number },
): number => left.score - right.score ||
  left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
  left.id.localeCompare(right.id);

export const contactSuggestions = (
  book: ContactBook | null,
  value: string,
  limit = 8,
): readonly ContactSuggestion[] => {
  if (!book || limit < 1) return [];
  const query = searchKey(recipientSuggestionQuery(value));
  const ranked: Array<ContactSuggestion & { score: number }> = [];
  const contactEmails = new Set<string>();
  for (const contact of book.contacts) {
    for (const email of contact.emails) contactEmails.add(contactEmailKey(email.email));
    for (const email of contact.emails) {
      const score = matchScore(query, [contact.name, email.email, email.label ?? ""]);
      if (score < 2) ranked.push({
        description: email.email,
        id: `contact:${contact.id}:${contactEmailKey(email.email)}`,
        kind: "contact",
        label: contact.name,
        replacement: replaceTail(value, formatAddressInput([{
          email: email.email,
          name: contact.name,
        }])),
        score,
      });
    }
  }
  for (const group of book.groups) {
    const score = matchScore(query, [group.name]);
    if (score === 2) continue;
    const members = group.contactIds.flatMap((contactId) => {
      const contact = book.contacts.find(({ id }) => id === contactId);
      const email = contact?.emails[0];
      return contact && email ? [{ email: email.email, name: contact.name }] : [];
    });
    if (members.length > 0) ranked.push({
      description: `${members.length} member${members.length === 1 ? "" : "s"}`,
      id: `group:${group.id}`,
      kind: "group",
      label: group.name,
      replacement: replaceTail(value, formatAddressInput(members)),
      score,
    });
  }
  for (const recent of book.recents) {
    if (contactEmails.has(contactEmailKey(recent.email))) continue;
    const score = matchScore(query, [recent.name ?? "", recent.email]);
    if (score < 2) ranked.push({
      description: recent.email,
      id: `recent:${contactEmailKey(recent.email)}`,
      kind: "recent",
      label: recent.name ?? recent.email,
      replacement: replaceTail(value, formatAddressInput([recent])),
      score,
    });
  }
  return ranked.sort(compareSuggestions).slice(0, limit).map((item) => ({
    description: item.description,
    id: item.id,
    kind: item.kind,
    label: item.label,
    replacement: item.replacement,
  }));
};
