import "server-only";

import type { DraftContent } from "@/domain/mail/draft";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import type { MailAccount, ReplyContext } from "@/domain/mail/mail";
import type { DraftId } from "@/domain/shared/brand";
import {
  createMessageId,
  safeMessageId,
  safeReplyReferences,
} from "@/infrastructure/providers/message-id";
import { jmapComposeBody } from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import {
  isVedaDraftKeyword,
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import {
  jmapIdBooleanRecordSchema,
  jmapKeywordBooleanRecordSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";

const addresses = (
  values: DraftContent["to"],
): readonly { readonly email: string; readonly name?: string }[] =>
  values.map(({ email, name }) => (name ? { email, name } : { email }));

const preservedKeywords = (
  email?: JmapDraftEmail,
): Readonly<Record<string, true>> =>
  Object.fromEntries(
    Object.entries(email?.keywords ?? {}).filter(
      ([keyword, enabled]) => enabled && !isVedaDraftKeyword(keyword),
    ),
  ) as Readonly<Record<string, true>>;

const preservedMailboxes = (
  email?: JmapDraftEmail,
): Readonly<Record<string, true>> =>
  Object.fromEntries(
    Object.entries(email?.mailboxIds ?? {}).filter(([, enabled]) => enabled),
  ) as Readonly<Record<string, true>>;

interface DraftReplyMetadata {
  readonly messageId: string | null;
  readonly references: readonly string[];
}

const existingReplyMetadata = (email: JmapDraftEmail): DraftReplyMetadata => {
  const messageId = safeMessageId(email.inReplyTo?.[0]);
  return {
    messageId,
    references: messageId
      ? safeReplyReferences(email.references ?? [], messageId)
      : [],
  };
};

const newReplyMetadata = (
  content: DraftContent,
  context: ReplyContext | null,
): DraftReplyMetadata => {
  const messageId = safeMessageId(context?.messageId);
  return {
    messageId,
    references: messageId
      ? safeReplyReferences(context?.references ?? [], messageId)
      : [],
  };
};

export const createJmapDraftObject = (
  content: DraftContent,
  composeId: DraftId,
  draftsMailboxId: string,
  account: Pick<MailAccount, "email" | "name">,
  replyContext: ReplyContext | null,
  existing?: JmapDraftEmail,
  options: {
    readonly additionalKeywords?: Readonly<Record<string, true>>;
    readonly includeVedaKeywords?: boolean;
  } = {},
): Readonly<Record<string, unknown>> => {
  const reply = existing
    ? existingReplyMetadata(existing)
    : newReplyMetadata(content, replyContext);
  const existingMessageId = safeMessageId(existing?.messageId?.[0]);
  const timestamp = new Date().toISOString();
  const keywords = {
    ...preservedKeywords(existing),
    $draft: true,
    ...(!existing || existing.keywords["$seen"] === true
      ? { $seen: true }
      : {}),
    ...(options.includeVedaKeywords === false
      ? {}
      : {
          [jmapDraftComposeKeyword(composeId)]: true,
          [jmapDraftContentKeyword(content)]: true,
        }),
    ...options.additionalKeywords,
  };
  const mailboxIds = {
    ...preservedMailboxes(existing),
    [draftsMailboxId]: true,
  };
  if (
    !jmapKeywordBooleanRecordSchema.safeParse(keywords).success ||
    !jmapIdBooleanRecordSchema.safeParse(mailboxIds).success
  ) {
    throw new DraftConflictError();
  }
  return {
    ...jmapComposeBody(content.body, content.htmlBody, []),
    bcc: addresses(content.bcc),
    cc: addresses(content.cc),
    from: [
      {
        email: account.email,
        name: existing ? (existing.from?.[0]?.name ?? null) : account.name,
      },
    ],
    "header:Message-ID:asMessageIds": [
      existingMessageId ?? createMessageId(account.email),
    ],
    ...(reply.messageId
      ? {
          "header:In-Reply-To:asMessageIds": [reply.messageId],
          "header:References:asMessageIds": reply.references,
        }
      : {}),
    keywords,
    mailboxIds,
    receivedAt: timestamp,
    sentAt: timestamp,
    subject: content.subject,
    to: addresses(content.to),
  };
};
