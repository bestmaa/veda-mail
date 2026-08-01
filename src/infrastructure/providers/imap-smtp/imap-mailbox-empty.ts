import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImapFlow, MailboxObject } from "imapflow";

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
import {
  decodeMailboxId,
  encodeMailboxId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";

const MAX_UID = 0xffff_ffff;
const UID_WINDOW = 4_096;

const cursorSchema = z.object({
  mailboxObjectId: z.string().min(1).max(1_024).nullable(),
  mailboxTag: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u),
  nextUid: z.number().int().min(1).max(MAX_UID),
  provider: z.literal("imap"),
  uidValidity: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  upperUid: z.number().int().min(1).max(MAX_UID),
  version: z.literal(1),
}).strict().refine((value) => value.nextUid <= value.upperUid, {
  message: "invalid UID range",
});
type Cursor = z.infer<typeof cursorSchema>;

const mailboxTag = (mailboxId: string): string => createHash("sha256")
  .update("veda-mail-mailbox-empty-imap-v1\0")
  .update(mailboxId, "utf8")
  .digest("base64url");

const readCursor = (
  input: MailboxEmptyInput,
  cursorSecret: string,
): Cursor | null => {
  if (!input.cursor) return null;
  try {
    const parsed = cursorSchema.parse(
      decodeMailboxEmptyCursor(input.cursor, cursorSecret),
    );
    if (parsed.mailboxTag !== mailboxTag(input.mailboxId)) {
      throw new Error("mailbox mismatch");
    }
    return parsed;
  } catch {
    throw new MailboxEmptyCursorError();
  }
};

const mailboxPath = (mailboxId: string): string => {
  try {
    const path = decodeMailboxId(mailboxId);
    if (encodeMailboxId(path) !== mailboxId) throw new Error("noncanonical");
    return path;
  } catch {
    throw new Error("IMAP mailbox identifier is invalid.");
  }
};

const assertOpenedMailbox = (opened: MailboxObject, path: string): void => {
  if (
    opened.path !== path ||
    opened.readOnly === true ||
    opened.uidValidity <= BigInt(0) ||
    opened.uidValidity > BigInt(MAX_UID) ||
    !Number.isSafeInteger(opened.uidNext) ||
    opened.uidNext < 1 ||
    opened.uidNext > MAX_UID + 1 ||
    (
      opened.mailboxId !== undefined &&
      (opened.mailboxId.length < 1 || opened.mailboxId.length > 1_024)
    )
  ) {
    throw new Error("The IMAP server did not open the expected mailbox.");
  }
};

const sameIncarnation = (cursor: Cursor, opened: MailboxObject): boolean =>
  cursor.uidValidity === opened.uidValidity.toString() &&
  (
    cursor.mailboxObjectId === null ||
    cursor.mailboxObjectId === opened.mailboxId
  );

const validateMatches = (
  found: number[] | false,
  start: number,
  end: number,
): number[] => {
  const raw = found === false ? [] : found;
  if (raw.length > UID_WINDOW) {
    throw new Error("The IMAP server returned an invalid mailbox search result.");
  }
  const matches = [...new Set(raw)].sort((left, right) => left - right);
  if (matches.some((uid) =>
    !Number.isInteger(uid) || uid < start || uid > end,
  )) {
    throw new Error("The IMAP server returned an invalid mailbox search result.");
  }
  return matches;
};

const verifiedDelete = async (
  client: ImapFlow,
  uids: readonly number[],
): Promise<void> => {
  if (uids.length === 0) return;
  if (!client.capabilities.has("UIDPLUS")) {
    throw new Error("Safe IMAP mailbox emptying requires UIDPLUS.");
  }
  if (!await client.messageDelete([...uids], { uid: true })) {
    throw new Error("The IMAP server did not delete the mailbox batch.");
  }
  const remaining = await client.search(
    { uid: uids.join(",") }, { uid: true },
  );
  const raw = remaining === false ? [] : remaining;
  const targets = new Set(uids);
  if (
    raw.some((uid) => !Number.isInteger(uid) || !targets.has(uid)) ||
    raw.length > 0
  ) {
    throw new Error("The IMAP server did not confirm the mailbox batch deletion.");
  }
};

const preparedResult = (
  cursor: Cursor,
  cursorSecret: string,
): MailboxEmptyResult => ({
  complete: false,
  cursor: encodeMailboxEmptyCursor(cursor, cursorSecret),
  processed: 0,
  removed: 0,
});

export const emptyImapMailbox = async (
  client: ImapFlow,
  input: MailboxEmptyInput,
  cursorSecret: string,
): Promise<MailboxEmptyResult> => {
  assertMailboxEmptyInput(input);
  const path = mailboxPath(input.mailboxId);
  const cursor = readCursor(input, cursorSecret);
  const opened = await client.mailboxOpen(path);
  assertOpenedMailbox(opened, path);

  if (!cursor) {
    const upperUid = opened.uidNext - 1;
    if (upperUid === 0 || opened.exists === 0) {
      return { complete: true, cursor: null, processed: 0, removed: 0 };
    }
    return preparedResult({
      mailboxObjectId: opened.mailboxId ?? null,
      mailboxTag: mailboxTag(input.mailboxId),
      nextUid: 1,
      provider: "imap",
      uidValidity: opened.uidValidity.toString(),
      upperUid,
      version: 1,
    }, cursorSecret);
  }

  if (!sameIncarnation(cursor, opened)) {
    throw new MailboxEmptyCursorError();
  }
  const windowEnd = Math.min(cursor.upperUid, cursor.nextUid + UID_WINDOW - 1);
  const matches = validateMatches(await client.search({
    uid: `${cursor.nextUid}:${windowEnd}`,
  }, { uid: true }), cursor.nextUid, windowEnd);
  const targets = matches.slice(0, input.limit);
  await verifiedDelete(client, targets);
  const windowDrained = matches.length <= input.limit;
  const nextUid = windowDrained
    ? windowEnd + 1
    : targets[targets.length - 1]! + 1;
  const processed = nextUid - cursor.nextUid;
  if (nextUid > cursor.upperUid) {
    return {
      complete: true,
      cursor: null,
      processed,
      removed: targets.length,
    };
  }
  return {
    complete: false,
    cursor: encodeMailboxEmptyCursor({ ...cursor, nextUid }, cursorSecret),
    processed,
    removed: targets.length,
  };
};
