import "server-only";

import type { MailAccount } from "@/domain/mail/mail";
import type { DraftContent } from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftContentTruncatedError,
} from "@/domain/mail/draft-errors";
import type { DraftId } from "@/domain/shared/brand";
import type { ProviderDraftId } from "@/domain/shared/brand";
import { matchesStoredJmapDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import {
  isVedaDraftKeyword,
  jmapDraftReplacementKeyword,
  VEDA_REPLACEMENT_KEYWORD_PREFIX,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { JmapDraftEmail } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.schema";
import type { StalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import {
  sameJmapDraftAttachments,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-attachments";
import type { JmapComposeAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";

interface ReplacementAnchor {
  readonly accountId: string;
  readonly attachmentIntent?: string;
  readonly attachmentCount?: number;
  readonly attachments?: readonly JmapComposeAttachment[];
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly existing: StalwartDraftRecord;
}

const authenticatedMetadata = (
  email: JmapDraftEmail,
  account: MailAccount,
): JmapDraftEmail => ({
  ...email,
  from: [
    {
      email: account.email,
      name: email.from?.[0]?.name ?? null,
    },
  ],
});

const keywordForMetadata = (
  anchor: ReplacementAnchor,
  metadata: JmapDraftEmail,
): string =>
  jmapDraftReplacementKeyword({
    accountId: anchor.accountId,
    ...(anchor.attachmentIntent
      ? { attachmentIntent: anchor.attachmentIntent }
      : {}),
    composeId: anchor.composeId,
    content: anchor.content,
    metadata,
    oldId: anchor.existing.detail.id,
    oldRevision: anchor.existing.detail.revision,
  });

export const replacementOperationKeyword = (
  anchor: ReplacementAnchor,
  account: MailAccount,
): string =>
  keywordForMetadata(
    anchor,
    authenticatedMetadata(anchor.existing.email, account),
  );

const rawMetadata = (email: JmapDraftEmail) =>
  JSON.stringify({
    from: email.from ?? [],
    inReplyTo: email.inReplyTo ?? [],
    messageId: email.messageId ?? [],
    references: email.references ?? [],
  });

const rawAttachmentMetadata = (email: JmapDraftEmail) =>
  JSON.stringify((email.attachments ?? []).map((part) => ({
    blobId: part.blobId ?? null,
    cid: part.cid ?? null,
    disposition: part.disposition ?? null,
    name: part.name ?? null,
    partId: part.partId ?? null,
    size: part.size ?? null,
    type: part.type,
  })));

const mutableMetadata = (email: JmapDraftEmail) =>
  JSON.stringify({
    keywords: Object.entries(email.keywords)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .sort(),
    mailboxIds: Object.entries(email.mailboxIds)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .sort(),
  });

const replacementMutableMetadata = (email: JmapDraftEmail) =>
  JSON.stringify({
    keywords: Object.entries(email.keywords)
      .filter(
        ([key, enabled]) => enabled && !isVedaDraftKeyword(key),
      )
      .map(([key]) => key)
      .sort(),
    mailboxIds: Object.entries(email.mailboxIds)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .sort(),
  });

export const assertUnchangedDraftMetadata = (
  expected: StalwartDraftRecord,
  fresh: StalwartDraftRecord,
): void => {
  if (
    expected.detail.id !== fresh.detail.id ||
    expected.detail.revision !== fresh.detail.revision ||
    rawMetadata(expected.email) !== rawMetadata(fresh.email) ||
    rawAttachmentMetadata(expected.email) !==
      rawAttachmentMetadata(fresh.email) ||
    mutableMetadata(expected.email) !== mutableMetadata(fresh.email)
  ) {
    throw new DraftConflictError();
  }
};

export const assertReplacementCandidate = (
  candidate: StalwartDraftRecord,
  anchor: ReplacementAnchor,
  account: MailAccount,
  keyword: string,
): void => {
  const operationKeywords = Object.entries(candidate.email.keywords)
    .filter(
      ([key, enabled]) =>
        enabled && key.startsWith(VEDA_REPLACEMENT_KEYWORD_PREFIX),
    )
    .map(([key]) => key);
  const expectedMetadata = authenticatedMetadata(
    anchor.existing.email,
    account,
  );
  if (
    candidate.detail.id === anchor.existing.detail.id ||
    candidate.detail.composeId !== anchor.composeId ||
    candidate.detail.hasUncertainSubmission ||
    operationKeywords.length !== 1 ||
    operationKeywords[0] !== keyword ||
    rawMetadata(candidate.email) !== rawMetadata(expectedMetadata) ||
    replacementMutableMetadata(candidate.email) !==
      replacementMutableMetadata(expectedMetadata) ||
    keywordForMetadata(anchor, candidate.email) !== keyword ||
    (anchor.attachments !== undefined && !sameJmapDraftAttachments(
      anchor.accountId,
      candidate.email,
      anchor.attachments,
    )) ||
    !matchesStoredJmapDraftContent(
      candidate.email,
      candidate.detail.content,
      anchor.content,
    )
  ) {
    throw new DraftConflictError();
  }
  if (
    candidate.detail.hasAttachments !==
      ((anchor.attachments?.length ?? anchor.attachmentCount ?? 0) > 0) ||
    (candidate.detail.attachments?.length ?? 0) !==
      (anchor.attachments?.length ?? anchor.attachmentCount ?? 0)
  ) throw new DraftConflictError();
  if (candidate.detail.hasTruncatedContent) {
    throw new DraftContentTruncatedError();
  }
};

export const assertOrphanReplacementCandidate = (
  candidate: StalwartDraftRecord,
  input: {
    readonly accountId: string;
    readonly attachmentIntent?: string;
    readonly attachmentCount?: number;
    readonly composeId: DraftId;
    readonly content: DraftContent;
    readonly oldId: ProviderDraftId;
    readonly oldRevision: string;
  },
  account: MailAccount,
): void => {
  const anchor: ReplacementAnchor = {
    accountId: input.accountId,
    ...(input.attachmentIntent
      ? { attachmentIntent: input.attachmentIntent }
      : {}),
    ...(input.attachmentCount === undefined
      ? {}
      : { attachmentCount: input.attachmentCount }),
    composeId: input.composeId,
    content: input.content,
    existing: {
      ...candidate,
      detail: {
        ...candidate.detail,
        id: input.oldId,
        revision: input.oldRevision,
      },
    },
  };
  const keyword = replacementOperationKeyword(anchor, account);
  assertReplacementCandidate(candidate, anchor, account, keyword);
};
