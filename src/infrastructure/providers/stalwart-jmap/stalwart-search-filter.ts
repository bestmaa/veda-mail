import "server-only";

import {
  MailSearchUnsupportedError,
  type MailSearchCriterion,
  type MailSearchQuery,
} from "@/domain/mail/mail-search";
import type { MailboxId } from "@/domain/shared/brand";

type JmapFilter = Readonly<Record<string, unknown>>;

const dateTime = (date: string): string => `${date}T00:00:00.000Z`;
const textValue = (value: string, phrase?: true): string => phrase
  ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  : value;

const criterionFilter = (criterion: MailSearchCriterion): JmapFilter => {
  if (criterion.type === "text") {
    return { [criterion.field]: textValue(criterion.value, criterion.phrase) };
  }
  if (criterion.type === "date") {
    return { [criterion.boundary]: dateTime(criterion.date) };
  }
  if (criterion.type === "size") {
    return criterion.boundary === "larger"
      ? { minSize: criterion.bytes + 1 }
      : { maxSize: criterion.bytes };
  }
  if (criterion.type === "has-attachment") {
    return { hasAttachment: true };
  }
  if (criterion.type === "mailbox") {
    throw new MailSearchUnsupportedError(["in:"]);
  }
  const keyword = criterion.state === "read" || criterion.state === "unread"
    ? "$seen"
    : "$flagged";
  return criterion.state === "read" || criterion.state === "starred"
    ? { hasKeyword: keyword }
    : { notKeyword: keyword };
};

export const stalwartSearchFilter = (
  mailboxId: MailboxId,
  query?: MailSearchQuery,
): JmapFilter => {
  if (!query) return { inMailbox: mailboxId };
  return {
    conditions: [
      { inMailbox: mailboxId },
      ...query.criteria.map(criterionFilter),
    ],
    operator: "AND",
  };
};
