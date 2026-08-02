import "server-only";

import { createHash } from "node:crypto";

import type { DraftContent } from "@/domain/mail/draft";
import { canonicalDraftComposeId } from "@/domain/mail/draft-validation";
import type { DraftId } from "@/domain/shared/brand";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";

export const VEDA_COMPOSE_KEYWORD_PREFIX = "veda-compose-";
export const VEDA_CONTENT_KEYWORD_PREFIX = "veda-content-sha256-";
export const VEDA_SEND_CLAIM_KEYWORD_PREFIX = "veda-send-claim-";
export const VEDA_REPLACEMENT_KEYWORD_PREFIX = "veda-replace-v1-";
export const VEDA_CREATE_KEYWORD_PREFIX = "veda-create-v1-";
export const VEDA_ATTACHMENT_INTENT_KEYWORD_PREFIX = "veda-attachments-v1-";

const VEDA_DRAFT_KEYWORD_PREFIXES = [
  VEDA_COMPOSE_KEYWORD_PREFIX,
  VEDA_CONTENT_KEYWORD_PREFIX,
  VEDA_SEND_CLAIM_KEYWORD_PREFIX,
  VEDA_REPLACEMENT_KEYWORD_PREFIX,
  VEDA_CREATE_KEYWORD_PREFIX,
  VEDA_ATTACHMENT_INTENT_KEYWORD_PREFIX,
] as const;

export const isVedaDraftKeyword = (keyword: string): boolean =>
  VEDA_DRAFT_KEYWORD_PREFIXES.some((prefix) => keyword.startsWith(prefix));

export const jmapDraftComposeKeyword = (composeId: DraftId): string =>
  `${VEDA_COMPOSE_KEYWORD_PREFIX}${canonicalDraftComposeId(composeId)}`;

export const jmapDraftContentFingerprint = (content: DraftContent): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        bcc: content.bcc.map(({ email, name }) => ({
          email,
          name: name ?? null,
        })),
        body: content.body,
        cc: content.cc.map(({ email, name }) => ({
          email,
          name: name ?? null,
        })),
        htmlBody: content.htmlBody ?? null,
        subject: content.subject,
        to: content.to.map(({ email, name }) => ({
          email,
          name: name ?? null,
        })),
      }),
    )
    .digest("hex");

export const jmapDraftContentKeyword = (content: DraftContent): string =>
  `${VEDA_CONTENT_KEYWORD_PREFIX}${jmapDraftContentFingerprint(content)}`;

export const jmapDraftAttachmentIntentKeyword = (fingerprint: string): string =>
  `${VEDA_ATTACHMENT_INTENT_KEYWORD_PREFIX}${fingerprint}`;

export const jmapDraftCreateKeyword = (input: {
  readonly accountId: string;
  readonly attachmentIntent?: string;
  readonly composeId: DraftId;
  readonly content: DraftContent;
}): string =>
  `${VEDA_CREATE_KEYWORD_PREFIX}${createHash("sha256")
    .update("veda-mail:jmap-draft-create:v1\0")
    .update(
      JSON.stringify({
        accountId: input.accountId,
        attachmentIntent: input.attachmentIntent ?? null,
        composeId: canonicalDraftComposeId(input.composeId),
        content: jmapDraftContentFingerprint(input.content),
        inReplyTo: input.content.inReplyTo ?? null,
      }),
    )
    .digest("hex")}`;

const replacementMetadata = (email: JmapDraftEmail) => ({
  from: (email.from ?? []).map(({ email: value, name }) => ({
    email: value,
    name: name ?? null,
  })),
  inReplyTo: email.inReplyTo ?? [],
  messageId: email.messageId ?? [],
  keywords: Object.entries(email.keywords)
    .filter(([key, enabled]) => enabled && !isVedaDraftKeyword(key))
    .map(([key]) => key)
    .sort(),
  mailboxIds: Object.entries(email.mailboxIds)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .sort(),
  references: email.references ?? [],
});

export const jmapDraftReplacementKeyword = (input: {
  readonly accountId: string;
  readonly attachmentIntent?: string;
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly metadata: JmapDraftEmail;
  readonly oldId: string;
  readonly oldRevision: string;
}): string =>
  `${VEDA_REPLACEMENT_KEYWORD_PREFIX}${createHash("sha256")
    .update("veda-mail:jmap-draft-replacement:v1\0")
    .update(
      JSON.stringify({
        accountId: input.accountId,
        attachmentIntent: input.attachmentIntent ?? null,
        composeId: canonicalDraftComposeId(input.composeId),
        content: jmapDraftContentFingerprint(input.content),
        metadata: replacementMetadata(input.metadata),
        oldId: input.oldId,
        oldRevision: input.oldRevision,
      }),
    )
    .digest("hex")}`;
