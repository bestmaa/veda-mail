import "server-only";

interface QueryResult {
  readonly accountId: string;
  readonly ids: readonly string[];
  readonly position: number;
  readonly total: number;
}

interface EmailResult {
  readonly accountId: string;
  readonly list: readonly { readonly id: string }[];
}

const inconsistent = (): never => {
  throw new Error("The mail provider returned an inconsistent message list.");
};

export const assertStalwartMessageListResult = (
  accountId: string,
  position: number,
  limit: number,
  query: QueryResult,
  emails: EmailResult,
): void => {
  if (
    query.accountId !== accountId ||
    emails.accountId !== accountId ||
    query.position !== position ||
    query.ids.length > limit ||
    query.total < query.position + query.ids.length ||
    emails.list.length !== query.ids.length ||
    new Set(query.ids).size !== query.ids.length ||
    emails.list.some((email, index) => email.id !== query.ids[index])
  ) inconsistent();
};
