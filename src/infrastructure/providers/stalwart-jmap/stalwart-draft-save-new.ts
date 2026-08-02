import "server-only";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { DraftConflictError, DraftUnavailableError } from "@/domain/mail/draft-errors";
import type { MailAccount, ReplyContext } from "@/domain/mail/mail";
import type { DraftId } from "@/domain/shared/brand";
import type { JmapComposeAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-compose-attachments";
import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import { safeMessageId, safeReplyReferences } from "@/infrastructure/providers/message-id";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { createJmapDraftObject } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.composer";
import { hasLosslessDraftHeaders, hasSupportedDraftHeaderInventory } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-header-safety";
import {
  jmapDraftCreateKeyword,
  jmapDraftAttachmentIntentKeyword,
  VEDA_CREATE_KEYWORD_PREFIX,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { matchesStoredJmapDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { hasSupportedDraftBodyStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import { createdDraftId } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mutation";
import {
  findStalwartDraftByKeyword,
  type StalwartDraftContext,
  type StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import type { StalwartDraftReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface StalwartDraftSaveMutation {
  readonly attachmentIntent?: string;
  readonly attachments?: readonly JmapComposeAttachment[];
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly context: StalwartDraftContext;
  readonly existing?: StalwartDraftRecord;
  readonly state: string;
}

const values = (input?: readonly string[] | null): readonly string[] =>
  input ?? [];

const assertNewCandidate = (
  candidate: StalwartDraftRecord,
  input: StalwartDraftSaveMutation,
  account: MailAccount,
  reply: ReplyContext | null | undefined,
  keyword: string,
): DraftDetail => {
  const operationKeywords = Object.entries(candidate.email.keywords)
    .filter(
      ([key, enabled]) => enabled && key.startsWith(VEDA_CREATE_KEYWORD_PREFIX),
    )
    .map(([key]) => key);
  const parent = safeMessageId(reply?.messageId);
  const expectedInReplyTo = parent ? [parent] : [];
  const expectedReferences = parent
    ? safeReplyReferences(reply?.references ?? [], parent)
    : [];
  const from = candidate.email.from ?? [];
  if (
    candidate.detail.composeId !== input.composeId ||
    candidate.detail.hasAttachments !== ((input.attachments?.length ?? 0) > 0) ||
    (candidate.detail.attachments?.length ?? 0) !== (input.attachments?.length ?? 0) ||
    candidate.detail.hasTruncatedContent ||
    candidate.detail.hasUncertainSubmission ||
    !hasCanonicalDraftContent(candidate.detail.content) ||
    operationKeywords.length !== 1 ||
    operationKeywords[0] !== keyword ||
    from.length !== 1 ||
    from[0]?.email.toLowerCase() !== account.email.toLowerCase() ||
    (reply !== undefined && (from[0]?.name ?? null) !== account.name) ||
    !hasLosslessDraftHeaders(candidate.email) ||
    !hasSupportedDraftHeaderInventory(candidate.email) ||
    !hasSupportedDraftBodyStructure(candidate.email) ||
    (reply !== undefined &&
      (JSON.stringify(values(candidate.email.inReplyTo)) !==
        JSON.stringify(expectedInReplyTo) ||
        JSON.stringify(values(candidate.email.references)) !==
          JSON.stringify(expectedReferences))) ||
    !matchesStoredJmapDraftContent(
      candidate.email,
      candidate.detail.content,
      input.content,
    )
  ) {
    throw new DraftConflictError();
  }
  return candidate.detail;
};

const validatedNewCandidate = async (
  drafts: StalwartDraftReader,
  candidate: StalwartDraftRecord,
  input: StalwartDraftSaveMutation,
  account: MailAccount,
  reply: ReplyContext | null | undefined,
  keyword: string,
): Promise<DraftDetail> => {
  assertNewCandidate(candidate, input, account, reply, keyword);
  const sole = await drafts.findByComposeId(input.context, input.composeId);
  if (sole?.detail.id !== candidate.detail.id) {
    throw new DraftConflictError();
  }
  return assertNewCandidate(sole, input, account, reply, keyword);
};

export const saveNewStalwartDraft = async (
  client: StalwartJmapClient,
  mail: StalwartMailReader,
  drafts: StalwartDraftReader,
  input: StalwartDraftSaveMutation,
): Promise<DraftDetail> => {
  const keyword = jmapDraftCreateKeyword({
    accountId: input.context.accountId,
    ...(input.attachmentIntent
      ? { attachmentIntent: input.attachmentIntent }
      : {}),
    composeId: input.composeId,
    content: input.content,
  });
  const account = await mail.getAccount();
  const createId = `draft-${input.composeId}`;
  let reply: ReplyContext | null | undefined;
  let state = input.state;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const recovered = await findStalwartDraftByKeyword(
      client,
      input.context,
      keyword,
    );
    if (recovered) {
      return validatedNewCandidate(
        drafts,
        recovered,
        input,
        account,
        undefined,
        keyword,
      );
    }
    if (await drafts.findByComposeId(input.context, input.composeId)) {
      throw new DraftConflictError();
    }
    const createReply =
      reply === undefined
        ? input.content.inReplyTo
          ? await mail.getReplyContext(input.content.inReplyTo)
          : null
        : reply;
    reply = createReply;
    const boundary: StalwartJmapRequestBoundary = { issued: false };
    try {
      const response = await client.request(
        [
          [
            "Email/set",
            {
              accountId: input.context.accountId,
              create: {
                [createId]: createJmapDraftObject(
                  input.content,
                  input.composeId,
                  input.context.draftsMailboxId,
                  account,
                  createReply,
                  undefined,
                  {
                    additionalKeywords: {
                      ...(input.attachmentIntent
                        ? { [jmapDraftAttachmentIntentKeyword(input.attachmentIntent)]: true }
                        : {}),
                      [keyword]: true,
                    },
                    attachments: input.attachments ?? [],
                  },
                ),
              },
              ifInState: state,
            },
            "save-draft",
          ],
        ],
        [JMAP_MAIL],
        undefined,
        boundary,
      );
      const providerId = createdDraftId(
        client,
        response,
        "save-draft",
        input.context.accountId,
        state,
        createId,
      );
      return validatedNewCandidate(
        drafts,
        await drafts.load(input.context, providerId),
        input,
        account,
        createReply,
        keyword,
      );
    } catch (error) {
      if (!boundary.issued) throw new DraftUnavailableError();
      if (
        error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch" &&
        attempt === 0
      ) {
        state = await drafts.state(input.context);
        continue;
      }
      const candidate = await findStalwartDraftByKeyword(
        client,
        input.context,
        keyword,
      );
      if (candidate) {
        return validatedNewCandidate(
          drafts,
          candidate,
          input,
          account,
          createReply,
          keyword,
        );
      }
      if (await drafts.findByComposeId(input.context, input.composeId)) {
        throw new DraftConflictError();
      }
      if (
        error instanceof StalwartJmapHttpError &&
        error.methodsWereNotExecuted
      ) {
        throw new DraftUnavailableError();
      }
      throw new DraftConflictError();
    }
  }
  throw new DraftConflictError();
};
