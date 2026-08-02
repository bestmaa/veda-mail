export type MailSearchAddressField = "cc" | "from" | "to";
export type MailSearchTextField = "body" | "subject" | "text";
export type MailSearchState = "read" | "starred" | "unread" | "unstarred";

export type MailSearchCriterion =
  | {
      readonly field: MailSearchAddressField | MailSearchTextField;
      readonly phrase?: true;
      readonly type: "text";
      readonly value: string;
    }
  | {
      readonly boundary: "after" | "before";
      readonly date: string;
      readonly type: "date";
    }
  | {
      readonly boundary: "larger" | "smaller";
      readonly bytes: number;
      readonly type: "size";
    }
  | { readonly type: "mailbox"; readonly value: string }
  | { readonly state: MailSearchState; readonly type: "state" }
  | { readonly type: "has-attachment" };

export interface MailSearchQuery {
  readonly canonical: string;
  readonly criteria: readonly MailSearchCriterion[];
}

export class MailSearchSyntaxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MailSearchSyntaxError";
  }
}

export class MailSearchUnsupportedError extends Error {
  public constructor(public readonly operators: readonly string[]) {
    super(`This provider does not support ${operators.join(", ")} search.`);
    this.name = "MailSearchUnsupportedError";
  }
}

export class MailSearchMailboxError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MailSearchMailboxError";
  }
}
