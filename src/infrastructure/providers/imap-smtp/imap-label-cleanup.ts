import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { ImapFlow, ListResponse } from "imapflow";

import {
  assertLabelCleanupInput,
  LabelCleanupCursorError,
  type LabelCleanupInput,
  type LabelCleanupResult,
} from "@/domain/mail/label";
import {
  decodeLabelCleanupCursor,
  encodeLabelCleanupCursor,
} from "@/infrastructure/providers/label-cleanup-cursor";

const MAX_LISTED_MAILBOXES = 4_096;
const UID_WINDOW = 4_096;
const MAX_UID = 0xffff_ffff;
type CleanupPhase = "clean" | "verify";

const cursorSchema = z.object({
  dirty: z.boolean(),
  labelId: z.string(),
  mailboxTag: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u).nullable(),
  nextUid: z.number().int().min(1).max(MAX_UID).nullable(),
  phase: z.enum(["clean", "verify"]),
  provider: z.literal("imap"),
  uidValidity: z.string().regex(/^[1-9][0-9]{0,19}$/u).nullable(),
  upperUid: z.number().int().min(0).max(MAX_UID).nullable(),
  version: z.literal(1),
}).strict();
type Cursor = z.infer<typeof cursorSchema>;

const initialCursor = (labelId: string, phase: CleanupPhase = "clean"): Cursor => ({
  dirty: false,
  labelId,
  mailboxTag: null,
  nextUid: null,
  phase,
  provider: "imap",
  uidValidity: null,
  upperUid: null,
  version: 1,
});
const readCursor = (input: LabelCleanupInput, cursorSecret: string): Cursor => {
  if (!input.cursor) return initialCursor(input.labelId);
  try {
    const parsed = cursorSchema.parse(
      decodeLabelCleanupCursor(input.cursor, cursorSecret),
    );
    if (parsed.labelId !== input.labelId) {
      throw new Error("mismatch");
    }
    return parsed;
  } catch {
    throw new LabelCleanupCursorError();
  }
};

const comparePath = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
const mailboxTag = (path: string): string => createHash("sha256")
  .update("veda-mail-label-cleanup-mailbox-v1\0")
  .update(path, "utf8")
  .digest("base64url");
const selectableMailboxes = (listed: readonly ListResponse[]): ListResponse[] => {
  if (listed.length > MAX_LISTED_MAILBOXES) {
    throw new Error("The IMAP account contains too many mailboxes for label cleanup.");
  }
  const unique = new Map<string, ListResponse>();
  for (const mailbox of listed) {
    if (
      mailbox.listed &&
      ![...mailbox.flags].some((flag) => flag.toLowerCase() === "\\noselect")
    ) {
      if (mailbox.path.length > 4_096) {
        throw new Error("An IMAP mailbox path is too long for label cleanup.");
      }
      unique.set(mailbox.path, mailbox);
    }
  }
  return [...unique.values()].sort((left, right) =>
    comparePath(left.path, right.path),
  );
};

const finishSweep = (
  cursor: Cursor,
  cursorSecret: string,
  processed = 0,
  removed = 0,
): LabelCleanupResult => {
  if (cursor.phase === "clean") {
    return {
      complete: false,
      cursor: encodeLabelCleanupCursor(
        initialCursor(cursor.labelId, "verify"), cursorSecret,
      ),
      processed,
      removed,
    };
  }
  if (cursor.dirty) {
    return {
      complete: false,
      cursor: encodeLabelCleanupCursor(
        initialCursor(cursor.labelId, "verify"), cursorSecret,
      ),
      processed,
      removed,
    };
  }
  return { complete: true, cursor: null, processed, removed };
};

const nextMailboxCursor = (
  cursor: Cursor,
  mailboxes: readonly ListResponse[],
  index: number,
  cursorSecret: string,
  processed = 0,
  removed = 0,
): LabelCleanupResult => {
  const next = mailboxes[index + 1];
  if (!next) return finishSweep(cursor, cursorSecret, processed, removed);
  return {
    complete: false,
    cursor: encodeLabelCleanupCursor({
      ...cursor,
      mailboxTag: mailboxTag(next.path),
      nextUid: null,
      uidValidity: null,
      upperUid: null,
    }, cursorSecret),
    processed,
    removed,
  };
};

const verifiedRemoval = async (
  client: ImapFlow,
  labelId: string,
  uids: readonly number[],
): Promise<void> => {
  if (uids.length === 0) return;
  await client.messageFlagsRemove([...uids], [labelId], { uid: true });
  const fetched = await client.fetchAll(
    [...uids], { flags: true, uid: true }, { uid: true },
  );
  const byUid = new Map(fetched.map((message) => [message.uid, message]));
  if (uids.some((uid) => {
    const message = byUid.get(uid);
    return !message || [...(message.flags ?? [])].some(
      (flag) => flag.toLowerCase() === labelId,
    );
  })) {
    throw new Error("The IMAP server did not confirm the label cleanup batch.");
  }
};

export const cleanupImapLabel = async (
  client: ImapFlow,
  input: LabelCleanupInput,
  cursorSecret: string,
): Promise<LabelCleanupResult> => {
  assertLabelCleanupInput(input);
  let cursor = readCursor(input, cursorSecret);
  const mailboxes = selectableMailboxes(await client.list());
  let index = cursor.mailboxTag === null
    ? 0
    : mailboxes.findIndex((mailbox) =>
      mailboxTag(mailbox.path) === cursor.mailboxTag,
    );
  if (index < 0) {
    index = 0;
    cursor = {
      ...cursor,
      dirty: cursor.phase === "verify" || cursor.dirty,
      nextUid: null,
      uidValidity: null,
      upperUid: null,
    };
  }
  const mailbox = mailboxes[index];
  if (!mailbox) return finishSweep(cursor, cursorSecret);
  const opened = await client.mailboxOpen(mailbox.path);
  const validity = opened.uidValidity.toString();
  const sameIncarnation = cursor.mailboxTag === mailboxTag(mailbox.path) &&
    cursor.uidValidity === validity;
  const nextUid = sameIncarnation ? (cursor.nextUid ?? 1) : 1;
  const upperUid = sameIncarnation
    ? (cursor.upperUid ?? Math.max(0, opened.uidNext - 1))
    : Math.max(0, opened.uidNext - 1);
  if (nextUid > upperUid) {
    return nextMailboxCursor(cursor, mailboxes, index, cursorSecret);
  }
  const windowEnd = Math.min(upperUid, nextUid + UID_WINDOW - 1);
  const found = await client.search({
    keyword: input.labelId,
    uid: `${nextUid}:${windowEnd}`,
  }, { uid: true });
  const rawMatches = found === false ? [] : found;
  if (rawMatches.length > UID_WINDOW) {
    throw new Error("The IMAP server returned an invalid label search result.");
  }
  const matches = [...new Set(rawMatches)];
  if (
    matches.length > UID_WINDOW ||
    matches.some((uid) =>
      !Number.isInteger(uid) || uid < nextUid || uid > windowEnd,
    )
  ) {
    throw new Error("The IMAP server returned an invalid label search result.");
  }
  const targets = matches.slice(0, input.limit);
  await verifiedRemoval(client, input.labelId, targets);
  const windowDrained = matches.length <= input.limit;
  const advancedUid = windowDrained ? windowEnd + 1 : nextUid;
  const dirty = cursor.dirty || (cursor.phase === "verify" && targets.length > 0);
  if (advancedUid > upperUid) {
    return nextMailboxCursor(
      { ...cursor, dirty },
      mailboxes,
      index,
      cursorSecret,
      targets.length,
      targets.length,
    );
  }
  return {
    complete: false,
    cursor: encodeLabelCleanupCursor({
      ...cursor,
      dirty,
      mailboxTag: mailboxTag(mailbox.path),
      nextUid: advancedUid,
      uidValidity: validity,
      upperUid,
    }, cursorSecret),
    processed: targets.length,
    removed: targets.length,
  };
};
