import type { MailboxId } from "@/domain/shared/brand";

export const MAILBOX_EMPTY_MAX_BATCH = 100;
export const MAILBOX_EMPTY_MAX_CURSOR_CHARACTERS = 8_192;

export interface MailboxEmptyInput {
  readonly cursor?: string;
  readonly limit: number;
  readonly mailboxId: MailboxId;
}

export interface MailboxEmptyResult {
  readonly complete: boolean;
  readonly cursor: string | null;
  readonly processed: number;
  readonly removed: number;
}

export interface MailboxEmptyOperation {
  readonly mailboxId: MailboxId;
  readonly processed: number;
  readonly removed: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface MailboxEmptyUpdate {
  readonly complete: boolean;
  readonly processed: number;
  readonly removed: number;
}

export class MailboxEmptyCursorError extends Error {
  public constructor() {
    super("Mailbox empty cursor is invalid.");
    this.name = "MailboxEmptyCursorError";
  }
}

export const assertMailboxEmptyInput = (input: MailboxEmptyInput): void => {
  if (input.mailboxId.length < 1 || input.mailboxId.length > 2_048) {
    throw new Error("Mailbox identifier is invalid.");
  }
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAILBOX_EMPTY_MAX_BATCH
  ) {
    throw new Error("Mailbox empty batch size is invalid.");
  }
  if (
    input.cursor !== undefined &&
    (input.cursor.length < 1 ||
      input.cursor.length > MAILBOX_EMPTY_MAX_CURSOR_CHARACTERS ||
      !/^[A-Za-z0-9_-]+$/u.test(input.cursor))
  ) {
    throw new Error("Mailbox empty cursor is invalid.");
  }
};
