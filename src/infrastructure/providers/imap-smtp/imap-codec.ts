import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  ImapMessageReference,
  ImapSmtpMemberConfig,
} from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const referenceSchema = z
  .object({
    accountScope: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/u),
    mailbox: z.string().min(1).max(1024),
    uid: z.number().int().positive().safe(),
    uidValidity: z.string().regex(/^[1-9]\d{0,39}$/u),
    version: z.literal(1),
  })
  .strict();

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decode = (value: string): unknown =>
  JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

export const encodeMailboxId = (mailbox: string): string =>
  encode({ mailbox });

export const decodeMailboxId = (value: string): string => {
  const mailbox = z
    .object({ mailbox: z.string().min(1).max(1024) })
    .strict()
    .parse(decode(value)).mailbox;
  if (encodeMailboxId(mailbox) !== value) {
    throw new Error("IMAP mailbox reference is invalid.");
  }
  return mailbox;
};

export const imapMessageAccountScope = (
  config: Pick<
    ImapSmtpMemberConfig,
    "imapHost" | "imapPort" | "username"
  >,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.imapHost.trim().toLowerCase(),
        config.imapPort.trim(),
        config.username,
      ]),
    )
    .digest("base64url");

export const createImapMessageReference = (
  config: Pick<
    ImapSmtpMemberConfig,
    "imapHost" | "imapPort" | "username"
  >,
  input: {
    readonly mailbox: string;
    readonly uid: number;
    readonly uidValidity: bigint;
  },
): ImapMessageReference => {
  if (input.uidValidity <= BigInt(0)) {
    throw new Error("IMAP UIDVALIDITY must be positive.");
  }
  return {
    accountScope: imapMessageAccountScope(config),
    mailbox: input.mailbox,
    uid: input.uid,
    uidValidity: input.uidValidity.toString(),
    version: 1,
  };
};

export const encodeMessageId = (reference: ImapMessageReference): string =>
  encode(referenceSchema.parse(reference));

export const encodeScopedImapMessageId = (
  config: Parameters<typeof createImapMessageReference>[0],
  input: Parameters<typeof createImapMessageReference>[1],
): string => encodeMessageId(createImapMessageReference(config, input));

export const decodeMessageId = (value: string): ImapMessageReference =>
  referenceSchema.parse(decode(value));

export const decodeScopedImapMessageId = (
  config: Pick<
    ImapSmtpMemberConfig,
    "imapHost" | "imapPort" | "username"
  >,
  value: string,
): ImapMessageReference => {
  const reference = decodeMessageId(value);
  if (
    encodeMessageId(reference) !== value ||
    reference.accountScope !== imapMessageAccountScope(config)
  ) {
    throw new Error("IMAP message reference is invalid.");
  }
  return reference;
};

export const imapUidValidityMatches = (
  reference: ImapMessageReference,
  uidValidity: bigint,
): boolean =>
  uidValidity > BigInt(0) &&
  reference.uidValidity === uidValidity.toString();
