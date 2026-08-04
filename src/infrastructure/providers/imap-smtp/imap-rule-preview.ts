import "server-only";

import type {
  FetchMessageObject,
  FetchQueryObject,
  MessageAddressObject,
} from "imapflow";

import {
  MAX_MAIL_RULE_PREVIEW_HEADERS,
  MAX_MAIL_RULE_PREVIEW_MESSAGES,
  type MailRule,
  type RulePreviewInput,
  type RulePreviewResult,
} from "@/domain/mail/rule";
import { id } from "@/domain/shared/brand";
import { evaluateMailRules } from "@/server/rules/rule-evaluator";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { hasImapDownloadableAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-structure";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const MAX_HEADER_BYTES = 64 * 1_024;
const MAX_HEADER_VALUES = 100;
const MAX_HEADER_VALUE_CHARACTERS = 8_192;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;

const customHeaders = (rules: readonly MailRule[]): readonly string[] =>
  [...new Set(rules.flatMap(({ conditions }) => conditions.flatMap((condition) =>
    condition.kind === "header" ? [condition.name.toLowerCase()] : [],
  )))];

const addresses = (values?: readonly MessageAddressObject[]): readonly string[] => {
  if ((values?.length ?? 0) > 100) {
    throw new Error("A preview message has too many addresses.");
  }
  return (values ?? []).flatMap(({ address }) => {
    if (!address) return [];
    if (address.length > 998) throw new Error("A preview address is too large.");
    return [address];
  });
};

const parseHeaders = (
  source: Buffer | undefined,
  expected: readonly string[],
): Readonly<Record<string, readonly string[]>> => {
  if (!source) return {};
  if (source.byteLength > MAX_HEADER_BYTES || source.includes(0)) {
    throw new Error("The provider returned oversized preview headers.");
  }
  const names = new Set(expected);
  const result: Record<string, string[]> = {};
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch {
    throw new Error("A preview header is not valid UTF-8.");
  }
  const unfolded = decoded.replace(/\r?\n[\t ]+/gu, " ");
  for (const line of unfolded.split(/\r?\n/gu)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).toLowerCase();
    if (!names.has(name)) continue;
    const value = line.slice(separator + 1).trim();
    if (value.length > MAX_HEADER_VALUE_CHARACTERS) {
      throw new Error("A preview header value is too large.");
    }
    const values = result[name] ?? [];
    if (values.length >= MAX_HEADER_VALUES) {
      throw new Error("A preview message has too many header values.");
    }
    values.push(value);
    result[name] = values;
  }
  return result;
};

const resultFor = (
  config: ImapSmtpMemberConfig,
  uidValidity: bigint,
  rules: readonly MailRule[],
  headers: readonly string[],
  message: FetchMessageObject,
): RulePreviewResult => {
  const received = new Date(message.internalDate ?? message.envelope?.date ?? NaN);
  if (!Number.isFinite(received.valueOf()) || (message.size ?? -1) < 0) {
    throw new Error("The provider returned invalid preview message facts.");
  }
  if ((message.envelope?.subject?.length ?? 0) > 998) {
    throw new Error("A preview subject is too large.");
  }
  const messageId = id.message(encodeScopedImapMessageId(config, {
    mailbox: "INBOX", uid: message.uid, uidValidity,
  }));
  const facts = {
    cc: addresses(message.envelope?.cc), from: addresses(message.envelope?.from),
    hasAttachment: hasImapDownloadableAttachment(message.bodyStructure),
    headers: parseHeaders(message.headers, headers), id: messageId,
    recipient: [], receivedAt: received.toISOString(), size: message.size ?? 0,
    subject: message.envelope?.subject ?? "",
    to: addresses(message.envelope?.to),
  };
  return {
    evaluation: evaluateMailRules(rules, facts), from: facts.from,
    messageId, receivedAt: facts.receivedAt, subject: facts.subject,
  };
};

export const previewImapRules = (
  config: ImapSmtpMemberConfig,
  input: RulePreviewInput,
): Promise<readonly RulePreviewResult[]> => withImapClient(config, async (client) => {
  if (input.limit < 1 || input.limit > MAX_MAIL_RULE_PREVIEW_MESSAGES) {
    throw new Error("Rule preview limit is invalid.");
  }
  if (input.rules.some(({ conditions }) => conditions.some((condition) =>
    condition.kind === "address" && condition.field === "recipient"))) {
    throw new Error("Envelope-recipient conditions cannot be previewed.");
  }
  const headers = customHeaders(input.rules);
  if (headers.length > MAX_MAIL_RULE_PREVIEW_HEADERS ||
    headers.some((name) => !HEADER_NAME.test(name))) {
    throw new Error("Rule preview headers are invalid.");
  }
  const opened = await client.mailboxOpen("INBOX", { readOnly: true });
  const matches = await client.search({ all: true }, { uid: true });
  const uids = (matches === false ? [] : matches).slice(-input.limit).reverse();
  const query: FetchQueryObject = {
    bodyStructure: true, envelope: true, internalDate: true, size: true, uid: true,
    ...(headers.length ? { bodyParts: [{
      key: `HEADER.FIELDS (${headers.join(" ")})`,
      maxLength: MAX_HEADER_BYTES + 1,
    }] } : {}),
  };
  const messages = uids.length
    ? await client.fetchAll(uids, query, { uid: true }) : [];
  const byUid = new Map(messages.map((message) => [message.uid, message]));
  return uids.map((uid) => {
    const message = byUid.get(uid);
    if (!message) throw new Error("The provider omitted a preview message.");
    return resultFor(config, opened.uidValidity, input.rules, headers, message);
  });
});
