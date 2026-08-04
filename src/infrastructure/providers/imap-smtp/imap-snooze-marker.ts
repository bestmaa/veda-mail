import "server-only";

import { createHash } from "node:crypto";
import type { ImapFlow, MailboxObject } from "imapflow";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const base32 = (input: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = value * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
      value &= (1 << bits) - 1;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
};

export const imapSnoozeMarker = (
  operationId: string,
  accountScope: string,
): string => {
  if (!/^[0-9a-f-]{36}$/iu.test(operationId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(accountScope)) {
    throw new Error("The snooze operation identity is invalid.");
  }
  const digest = createHash("sha256")
    .update(`veda-mail/snooze-marker/v1\0${accountScope}\0${operationId}`)
    .digest().subarray(0, 16);
  return `veda-snooze-${base32(digest)}`;
};

export const assertImapSnoozeSupport = (
  client: ImapFlow,
  opened: MailboxObject,
): void => {
  if (!client.capabilities.has("MOVE") || !client.capabilities.has("UIDPLUS")) {
    throw new Error("Safe snooze requires IMAP MOVE and UIDPLUS.");
  }
  if (opened.readOnly || !opened.permanentFlags?.has("\\*")) {
    throw new Error("The mailbox cannot persist snooze recovery markers.");
  }
};

export const markerUids = async (
  client: ImapFlow,
  marker: string,
): Promise<readonly number[]> => {
  const matches = await client.search({ keyword: marker }, { uid: true });
  if (matches === false) throw new Error("The IMAP marker search failed.");
  if (matches.length > 1) throw new Error("The snooze marker is ambiguous.");
  return matches;
};

export const hasMarker = (
  flags: Iterable<string> | undefined,
  marker: string,
): boolean => [...(flags ?? [])].some((flag) => flag === marker);

export const addAndVerifyMarker = async (
  client: ImapFlow,
  uid: number,
  marker: string,
): Promise<void> => {
  if (!await client.messageFlagsAdd(uid, [marker], { uid: true })) {
    throw new Error("The IMAP server rejected the snooze marker.");
  }
  const verified = await client.fetchOne(uid, { flags: true, uid: true }, { uid: true });
  if (!verified || verified.uid !== uid || !hasMarker(verified.flags, marker)) {
    throw new Error("The IMAP server did not persist the snooze marker.");
  }
};

export const removeAndVerifyMarker = async (
  client: ImapFlow,
  uid: number,
  marker: string,
): Promise<void> => {
  if (!await client.messageFlagsRemove(uid, [marker], { uid: true })) {
    throw new Error("The IMAP server rejected snooze marker cleanup.");
  }
  const verified = await client.fetchOne(uid, { flags: true, uid: true }, { uid: true });
  if (!verified || verified.uid !== uid || hasMarker(verified.flags, marker)) {
    throw new Error("The IMAP server did not remove the snooze marker.");
  }
};
