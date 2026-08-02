import type { Mailbox } from "@/domain/mail/mail";
import {
  MailSearchMailboxError,
  type MailSearchQuery,
} from "@/domain/mail/mail-search";
import { serializeMailSearch } from "@/domain/mail/mail-search-parser";
import type { MailboxId } from "@/domain/shared/brand";

interface MailSearchScope {
  readonly mailboxId: MailboxId;
  readonly providerSearch?: MailSearchQuery;
}

const normalized = (value: string): string => value.trim().toLowerCase();

export const hasMailboxSearch = (query?: MailSearchQuery): boolean =>
  query?.criteria.some((criterion) => criterion.type === "mailbox") ?? false;

export const resolveMailSearchScope = (
  mailboxes: readonly Mailbox[],
  search: MailSearchQuery,
): MailSearchScope => {
  const criterion = search.criteria.find((item) => item.type === "mailbox");
  if (!criterion) {
    throw new MailSearchMailboxError("The mailbox search is missing its mailbox.");
  }
  const value = normalized(criterion.value);
  const roleMatches = mailboxes.filter((mailbox) =>
    mailbox.role !== "custom" && normalized(mailbox.role) === value);
  const matches = roleMatches.length ? roleMatches : mailboxes.filter(
    (mailbox) => normalized(mailbox.name) === value,
  );
  if (matches.length !== 1) {
    throw new MailSearchMailboxError(
      matches.length ? "The mailbox search is ambiguous." : "The searched mailbox was not found.",
    );
  }
  const criteria = search.criteria.filter((item) => item.type !== "mailbox");
  const canonical = serializeMailSearch(criteria);
  return {
    mailboxId: matches[0]!.id,
    ...(canonical ? { providerSearch: { canonical, criteria } } : {}),
  };
};
