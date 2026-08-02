import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { ParsedMail } from "mailparser";
import { simpleParser } from "mailparser";
import addressparser from "nodemailer/lib/addressparser";
import MailComposer from "nodemailer/lib/mail-composer";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import { isCanonicalDraftComposeHeader } from "@/domain/mail/draft-validation";
import type { MailAddress } from "@/domain/mail/mail";
import { id, type DraftId, type ProviderDraftId } from "@/domain/shared/brand";
import { jmapDraftContentFingerprint } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";

const COMPOSE_HEADER = "x-veda-compose-id";
const CONTENT_HEADER = "x-veda-content-sha256";
const MIME_HEADER = "x-veda-mime-sha256";
const REPLY_HEADER = "x-veda-reply-message-id";
const WRITE_HEADER = "x-veda-write-id";

const allowedHeaders = new Set([
  "bcc", "cc", "content-transfer-encoding", "content-type", "date",
  "from", "message-id", "mime-version", "subject", "to",
  COMPOSE_HEADER, CONTENT_HEADER, MIME_HEADER, REPLY_HEADER, WRITE_HEADER,
]);
const addressHeaders = new Set(["bcc", "cc", "from", "to"]);

const address = ({ email, name }: MailAddress) => ({
  address: email,
  name: name ?? "",
});

const parsedAddresses = (
  value: ParsedMail["to"],
): readonly MailAddress[] =>
  (Array.isArray(value) ? value : value ? [value] : []).flatMap((group) =>
    group.value.map((item) => ({
      email: item.address ?? "",
      name: item.name || null,
    })),
  );

const stringHeader = (mail: ParsedMail, name: string): string | null => {
  const value = mail.headers.get(name);
  return typeof value === "string" ? value : null;
};

const hasSafeHeaderInventory = (mail: ParsedMail): boolean => {
  const names = mail.headerLines.map(({ key }) => key.toLowerCase());
  const count = (name: string) => names.filter((value) => value === name).length;
  return (
    names.every((name) => allowedHeaders.has(name)) &&
    new Set(names).size === names.length &&
    count("from") === 1 &&
    count("message-id") === 1 &&
    count("content-type") === 1 &&
    count(COMPOSE_HEADER) === 1 &&
    count(CONTENT_HEADER) === 1 &&
    count(MIME_HEADER) === 1 &&
    count(WRITE_HEADER) === 1 &&
    count(REPLY_HEADER) <= 1
  );
};

const hasNamedAddressGroup = (mail: ParsedMail): boolean =>
  mail.headerLines.some(({ key, line }) => {
    if (!addressHeaders.has(key.toLowerCase())) return false;
    const value = line.slice(line.indexOf(":") + 1);
    try {
      return addressparser(value).some((entry) => "group" in entry);
    } catch {
      return true;
    }
  });

const mimeBody = (source: Buffer): Buffer | null => {
  const separator = source.indexOf("\r\n\r\n");
  return separator < 0 ? null : source.subarray(separator + 4);
};

const mimeDigest = (source: Buffer): string | null => {
  const body = mimeBody(source);
  return body ? createHash("sha256").update(body).digest("hex") : null;
};

const addMimeDigest = (source: Buffer): Buffer => {
  const separator = source.indexOf("\r\n\r\n");
  const digest = mimeDigest(source);
  if (separator < 0 || !digest) throw new Error("Draft MIME could not be composed.");
  return Buffer.concat([
    source.subarray(0, separator),
    Buffer.from(`\r\nX-Veda-MIME-Sha256: ${digest}`, "ascii"),
    source.subarray(separator),
  ]);
};

export interface ImapDraftMimeRecord {
  readonly detail: DraftDetail;
  readonly source: Buffer;
}

export const imapDraftRevision = (
  accountScope: string,
  providerDraftId: ProviderDraftId,
): string =>
  `imap-draft-v1-${createHash("sha256")
    .update(accountScope)
    .update("\0")
    .update(providerDraftId)
    .digest("base64url")}`;

export const composeImapDraft = async (
  content: DraftContent,
  composeId: DraftId,
  username: string,
): Promise<{ readonly raw: Buffer; readonly writeId: string }> => {
  const writeId = randomUUID();
  const mail = {
    bcc: content.bcc.map(address),
    cc: content.cc.map(address),
    disableFileAccess: true,
    disableUrlAccess: true,
    from: address({ email: username, name: null }),
    headers: {
      "X-Veda-Compose-Id": composeId,
      "X-Veda-Content-Sha256": jmapDraftContentFingerprint(content),
      ...(content.inReplyTo
        ? { "X-Veda-Reply-Message-Id": content.inReplyTo }
        : {}),
      "X-Veda-Write-Id": writeId,
    },
    html: content.htmlBody,
    subject: content.subject,
    text: content.body,
    textEncoding: "base64" as const,
    to: content.to.map(address),
  };
  const message = new MailComposer(mail).compile();
  message.keepBcc = true;
  return { raw: addMimeDigest(await message.build()), writeId };
};

export const parseImapDraft = async (input: {
  readonly accountScope: string;
  readonly internalDate: Date | string | undefined;
  readonly providerDraftId: ProviderDraftId;
  readonly source: Buffer;
  readonly username: string;
}): Promise<ImapDraftMimeRecord> => {
  const mail = await simpleParser(input.source, {
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
  });
  const composeHeader = stringHeader(mail, COMPOSE_HEADER);
  const replyHeader = stringHeader(mail, REPLY_HEADER);
  const baseContent = {
    bcc: parsedAddresses(mail.bcc),
    cc: parsedAddresses(mail.cc),
    ...(typeof mail.html === "string" ? { htmlBody: mail.html } : {}),
    ...(replyHeader ? { inReplyTo: id.message(replyHeader) } : {}),
    subject: mail.subject ?? "",
    to: parsedAddresses(mail.to),
  };
  const parsedBody = mail.text ?? "";
  const bodyCandidates = parsedBody.endsWith("\n")
    ? [parsedBody, parsedBody.slice(0, -1)]
    : [parsedBody];
  const expectedFingerprint = stringHeader(mail, CONTENT_HEADER);
  const content: DraftContent =
    bodyCandidates
      .map((body) => ({ ...baseContent, body }))
      .find(
        (candidate) =>
          jmapDraftContentFingerprint(candidate) === expectedFingerprint,
      ) ?? { ...baseContent, body: parsedBody };
  const from = parsedAddresses(mail.from);
  const safe =
    hasSafeHeaderInventory(mail) &&
    !hasNamedAddressGroup(mail) &&
    isCanonicalDraftComposeHeader(composeHeader) &&
    hasCanonicalDraftContent(content) &&
    expectedFingerprint === jmapDraftContentFingerprint(content) &&
    stringHeader(mail, MIME_HEADER) === mimeDigest(input.source) &&
    from.length === 1 &&
    from[0]?.email.toLowerCase() === input.username.toLowerCase() &&
    mail.attachments.length === 0;
  const updated = new Date(input.internalDate ?? Date.now());
  return {
    detail: {
      composeId: isCanonicalDraftComposeHeader(composeHeader)
        ? id.draft(composeHeader)
        : null,
      content,
      hasAttachments: mail.attachments.length > 0,
      hasTruncatedContent: !safe,
      hasUncertainSubmission: false,
      id: input.providerDraftId,
      revision: imapDraftRevision(input.accountScope, input.providerDraftId),
      updatedAt: Number.isNaN(updated.getTime())
        ? new Date(0).toISOString()
        : updated.toISOString(),
    },
    source: input.source,
  };
};

export const imapDraftWriteHeader = WRITE_HEADER;
