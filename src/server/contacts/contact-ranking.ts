import {
  type ContactBook,
  contactEmailKey,
  MAX_RECENT_RECIPIENT_BATCH,
  MAX_RECENT_RECIPIENTS,
  type RecentRecipient,
  type RecentRecipientInput,
} from "@/domain/member/contact";
import { recentRecipientInputSchema } from "@/server/contacts/contact-schema";
import {
  parseStoredContactBook,
  type StoredContactBook,
} from "@/server/contacts/contact-record";

const searchKey = (value: string): string =>
  value.normalize("NFKC").trim().toLowerCase();

const matchRank = (recipient: RecentRecipient, query: string): number => {
  const email = searchKey(recipient.email);
  const name = searchKey(recipient.name ?? "");
  if (!query || email.startsWith(query) || name.startsWith(query)) return 0;
  if (email.includes(query) || name.includes(query)) return 1;
  return 2;
};

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const rankRecentRecipients = (
  recents: readonly RecentRecipient[],
  query: string,
  limit: number,
): readonly RecentRecipient[] => {
  if (!Number.isSafeInteger(limit) ||
      limit < 1 || limit > MAX_RECENT_RECIPIENTS) {
    throw new RangeError(
      `Recent recipient limit must be between 1 and ${MAX_RECENT_RECIPIENTS}.`,
    );
  }
  const key = searchKey(query);
  return recents
    .filter((recipient) => matchRank(recipient, key) < 2)
    .sort((left, right) => {
      const match = matchRank(left, key) - matchRank(right, key);
      if (match !== 0) return match;
      const recent = compareText(right.lastUsedAt, left.lastUsedAt);
      if (recent !== 0) return recent;
      const frequency = right.useCount - left.useCount;
      if (frequency !== 0) return frequency;
      return compareText(
        contactEmailKey(left.email),
        contactEmailKey(right.email),
      );
    })
    .slice(0, limit);
};

export const addRecentRecipients = (
  current: ContactBook,
  inputs: readonly RecentRecipientInput[],
  now = new Date().toISOString(),
): StoredContactBook => {
  if (inputs.length > MAX_RECENT_RECIPIENT_BATCH) {
    throw new RangeError(
      `At most ${MAX_RECENT_RECIPIENT_BATCH} recent recipients can be recorded.`,
    );
  }
  const byEmail = new Map(
    current.recents.map((recent) => [contactEmailKey(recent.email), recent]),
  );
  const uniqueInputs = new Map(inputs.map((input) => {
    const parsed = recentRecipientInputSchema.parse(input);
    return [contactEmailKey(parsed.email), parsed] as const;
  }));
  for (const input of uniqueInputs.values()) {
    const key = contactEmailKey(input.email);
    const existing = byEmail.get(key);
    byEmail.set(key, {
      email: input.email,
      lastUsedAt: now,
      name: input.name ?? existing?.name ?? null,
      useCount: Math.min(Number.MAX_SAFE_INTEGER, (existing?.useCount ?? 0) + 1),
    });
  }
  return parseStoredContactBook({
    contacts: current.contacts,
    createdAt: current.createdAt ?? now,
    groups: current.groups,
    recents: rankRecentRecipients(
      [...byEmail.values()], "", MAX_RECENT_RECIPIENTS,
    ),
    revision: crypto.randomUUID(),
    updatedAt: now,
    version: 1,
  });
};
