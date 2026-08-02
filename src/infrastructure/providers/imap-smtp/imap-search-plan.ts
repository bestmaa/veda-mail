import "server-only";

import type { SearchObject } from "imapflow";

import {
  MailSearchUnsupportedError,
  type MailSearchCriterion,
  type MailSearchQuery,
} from "@/domain/mail/mail-search";

const criterionSearch = (
  criterion: MailSearchCriterion,
): { readonly key: keyof SearchObject; readonly search: SearchObject } => {
  if (criterion.type === "text") {
    const key = criterion.field as "body" | "cc" | "from" | "subject" | "text" | "to";
    return { key, search: { [key]: criterion.value } };
  }
  if (criterion.type === "date") {
    const key = criterion.boundary === "after" ? "since" : "before";
    return { key, search: { [key]: criterion.date } };
  }
  if (criterion.type === "size") {
    const key = criterion.boundary;
    return { key, search: { [key]: criterion.bytes } };
  }
  if (criterion.type === "has-attachment") {
    throw new MailSearchUnsupportedError(["has:attachment"]);
  }
  if (criterion.type === "mailbox") {
    throw new MailSearchUnsupportedError(["in:"]);
  }
  const positive = criterion.state === "read" || criterion.state === "starred";
  const key = criterion.state === "read" || criterion.state === "unread"
    ? "seen"
    : "flagged";
  return { key, search: { [key]: positive } };
};

export const imapSearchPlan = (query?: MailSearchQuery): readonly SearchObject[] => {
  if (!query) return [{ all: true }];
  const batches: { keys: Set<keyof SearchObject>; search: SearchObject }[] = [];
  for (const criterion of query.criteria) {
    const mapped = criterionSearch(criterion);
    const batch = batches.find(({ keys }) => !keys.has(mapped.key));
    if (batch) {
      batch.keys.add(mapped.key);
      Object.assign(batch.search, mapped.search);
    } else {
      batches.push({ keys: new Set([mapped.key]), search: { ...mapped.search } });
    }
  }
  return batches.map(({ search }) => search);
};

export const intersectImapSearchResults = (
  results: readonly (readonly number[])[],
): readonly number[] => {
  const [first = [], ...rest] = results;
  if (!rest.length) return first;
  const remaining = rest.map((items) => new Set(items));
  return first.filter((uid) => remaining.every((items) => items.has(uid)));
};
