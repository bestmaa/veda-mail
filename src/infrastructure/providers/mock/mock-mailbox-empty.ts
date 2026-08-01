import "server-only";

import { z } from "zod";

import type { MessageDetail } from "@/domain/mail/mail";
import {
  assertMailboxEmptyInput,
  MailboxEmptyCursorError,
  type MailboxEmptyInput,
  type MailboxEmptyResult,
} from "@/domain/mail/mailbox-empty";
import {
  decodeMailboxEmptyCursor,
  encodeMailboxEmptyCursor,
} from "@/infrastructure/providers/mailbox-empty-cursor";

const CURSOR_SECRET = "mock-mailbox-empty-cursor";
const cursorSchema = z.object({
  cutoff: z.iso.datetime({ offset: true }),
  mailboxId: z.string().min(1).max(2_048),
  provider: z.literal("mock"),
  version: z.literal(1),
}).strict();

const cutoffFor = (input: MailboxEmptyInput, now: Date): string => {
  if (!input.cursor) return now.toISOString();
  try {
    const cursor = cursorSchema.parse(
      decodeMailboxEmptyCursor(input.cursor, CURSOR_SECRET),
    );
    if (cursor.mailboxId !== input.mailboxId) throw new Error("mismatch");
    return cursor.cutoff;
  } catch {
    throw new MailboxEmptyCursorError();
  }
};

const cursorFor = (input: MailboxEmptyInput, cutoff: string): string =>
  encodeMailboxEmptyCursor({
    cutoff,
    mailboxId: input.mailboxId,
    provider: "mock",
    version: 1,
  }, CURSOR_SECRET);

export const emptyMockMailbox = (
  messages: MessageDetail[],
  input: MailboxEmptyInput,
  now = new Date(),
): MailboxEmptyResult => {
  assertMailboxEmptyInput(input);
  const cutoff = cutoffFor(input, now);
  const targets = messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) =>
      message.mailboxIds.includes(input.mailboxId) &&
      message.receivedAt < cutoff,
    )
    .slice(0, input.limit);
  if (!input.cursor) {
    return targets.length === 0
      ? { complete: true, cursor: null, processed: 0, removed: 0 }
      : {
          complete: false,
          cursor: cursorFor(input, cutoff),
          processed: 0,
          removed: 0,
        };
  }
  for (const { index } of [...targets].sort((left, right) =>
    right.index - left.index,
  )) {
    messages.splice(index, 1);
  }
  const complete = !messages.some((message) =>
    message.mailboxIds.includes(input.mailboxId) &&
    message.receivedAt < cutoff,
  );
  return {
    complete,
    cursor: complete ? null : cursorFor(input, cutoff),
    processed: targets.length,
    removed: targets.length,
  };
};
