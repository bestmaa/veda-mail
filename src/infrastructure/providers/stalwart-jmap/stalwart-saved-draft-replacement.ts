import "server-only";

import type { z } from "zod";

import type { SendMessageInput } from "@/domain/mail/mail";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import { id, type ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapHttpError, StalwartJmapMethodError, type StalwartJmapRequestBoundary } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { ClaimedDraft, SavedDraftSubmissionContext } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim";
import { createJmapDraftObject } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.composer";
import { allStalwartDraftAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-attachments";
import {
  jmapDraftComposeKeyword,
  jmapDraftContentKeyword,
  VEDA_COMPOSE_KEYWORD_PREFIX,
  VEDA_CONTENT_KEYWORD_PREFIX,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  hasSavedDraftSubmissionEvidence,
  savedDraftSubmissionOutcome,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-submission-result";
import { isValidSetError } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-submission";
import {
  JMAP_MAIL,
  JMAP_SUBMISSION,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import {
  hasAdvancedJmapSetState,
  hasUnchangedJmapSetState,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

export interface PreparedSavedDraftCopy {
  readonly emailId: ProviderDraftId;
  readonly state: string;
}
export type SendSavedDraftBatchOutcome =
  | { readonly copy: PreparedSavedDraftCopy; readonly kind: "accepted" }
  | { readonly copy: PreparedSavedDraftCopy; readonly kind: "rejected" }
  | { readonly error: unknown; readonly kind: "not-executed" }
  | { readonly kind: "rejected-before-copy" | "retry" }
  | { readonly copy?: PreparedSavedDraftCopy; readonly kind: "uncertain" };
type SetResult = z.infer<typeof jmapSetResultSchema>;
const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);
const noFailures = (result: SetResult): boolean =>
  [result.notCreated, result.notDestroyed, result.notUpdated].every(
    (value) => Object.keys(value ?? {}).length === 0,
  );
const strictCreatedCopy = (
  result: SetResult,
  accountId: string,
  state: string,
  createId: string,
): PreparedSavedDraftCopy | null => {
  const created = result.created?.[createId];
  return result.accountId === accountId &&
    hasAdvancedJmapSetState(result, state) &&
    exact(Object.keys(result.created ?? {}), [createId]) &&
    created?.id &&
    Object.keys(result.updated ?? {}).length === 0 &&
    (result.destroyed?.length ?? 0) === 0 &&
    noFailures(result)
    ? {
        emailId: id.providerDraft(created.id),
        state: result.newState as string,
      }
    : null;
};

const exactCreateRejection = (
  result: SetResult,
  accountId: string,
  state: string,
  createId: string,
): boolean =>
  result.accountId === accountId &&
  hasUnchangedJmapSetState(result, state) &&
  Object.keys(result.created ?? {}).length === 0 &&
  exact(Object.keys(result.notCreated ?? {}), [createId]) &&
  isValidSetError(result.notCreated?.[createId]) &&
  Object.keys(result.updated ?? {}).length === 0 &&
  (result.destroyed?.length ?? 0) === 0 &&
  Object.keys(result.notUpdated ?? {}).length === 0 &&
  Object.keys(result.notDestroyed ?? {}).length === 0;

const removalPatch = (
  input: SendMessageInput,
  claimed: ClaimedDraft,
): Readonly<Record<string, null>> => {
  const composeId = claimed.source.record.detail.composeId;
  if (!composeId) throw new DraftConflictError();
  const keywords = Object.entries(claimed.source.record.email.keywords)
    .filter(
      ([keyword, enabled]) =>
        enabled &&
        (keyword.startsWith(VEDA_COMPOSE_KEYWORD_PREFIX) ||
          keyword.startsWith(VEDA_CONTENT_KEYWORD_PREFIX)),
    )
    .map(([keyword]) => keyword);
  keywords.push(
    jmapDraftComposeKeyword(composeId),
    jmapDraftContentKeyword(input),
    claimed.claimKeyword,
  );
  return Object.fromEntries(
    [...new Set(keywords)].map((keyword) => [`keywords/${keyword}`, null]),
  );
};

export const sendClaimedStalwartDraft = async (
  client: StalwartJmapClient,
  input: SendMessageInput,
  claimed: ClaimedDraft,
  context: SavedDraftSubmissionContext,
): Promise<SendSavedDraftBatchOutcome> => {
  const composeId = claimed.source.record.detail.composeId;
  if (!composeId) throw new DraftConflictError();
  const createId = `send-${crypto.randomUUID()}`;
  let object: Readonly<Record<string, unknown>>;
  let cleanupPatch: Readonly<Record<string, null>>;
  try {
    object = createJmapDraftObject(
      input,
      composeId,
      context.draftMailboxId,
      {
        email: context.identity.email,
        name: context.identity.name ?? context.identity.email,
      },
      null,
      claimed.source.record.email,
      {
        additionalKeywords: { [claimed.claimKeyword]: true },
        attachments: allStalwartDraftAttachments(
          claimed.source.context.accountId,
          claimed.source.record.email,
        ),
      },
    );
    cleanupPatch = removalPatch(input, claimed);
  } catch (error) {
    return { error, kind: "not-executed" };
  }
  const boundary: StalwartJmapRequestBoundary = { issued: false };
  let response: Awaited<ReturnType<StalwartJmapClient["request"]>>;
  try {
    response = await client.request(
      [
        [
          "Email/set",
          {
            accountId: context.accountId,
            create: { [createId]: object },
            ifInState: claimed.source.record.state,
          },
          "create-send-copy",
        ],
        [
          "EmailSubmission/set",
          {
            accountId: context.accountId,
            create: {
              submit: {
                emailId: `#${createId}`,
                identityId: context.identity.id,
              },
            },
            onSuccessUpdateEmail: {
              "#submit": {
                [`mailboxIds/${context.draftMailboxId}`]: null,
                [`mailboxIds/${context.sentMailboxId}`]: true,
                "keywords/$draft": null,
                "keywords/$seen": true,
                ...cleanupPatch,
              },
            },
          },
          "submit-saved-draft",
        ],
      ],
      [JMAP_MAIL, JMAP_SUBMISSION],
      undefined,
      boundary,
    );
  } catch (error) {
    return !boundary.issued ||
      (error instanceof StalwartJmapHttpError && error.methodsWereNotExecuted)
      ? { error, kind: "not-executed" }
      : { kind: "uncertain" };
  }
  let create: SetResult;
  try {
    create = client.result(
      response,
      "create-send-copy",
      "Email/set",
      jmapSetResultSchema,
    );
  } catch (error) {
    if (
      error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch"
    ) {
      return hasSavedDraftSubmissionEvidence(response)
        ? { kind: "uncertain" }
        : { kind: "retry" };
    }
    return error instanceof StalwartJmapMethodError &&
      error.kind === "definitive" &&
      !hasSavedDraftSubmissionEvidence(response)
      ? { kind: "rejected-before-copy" }
      : { kind: "uncertain" };
  }
  const copy = strictCreatedCopy(
    create,
    context.accountId,
    claimed.source.record.state,
    createId,
  );
  if (!copy) {
    return exactCreateRejection(
      create,
      context.accountId,
      claimed.source.record.state,
      createId,
    ) && !hasSavedDraftSubmissionEvidence(response)
      ? { kind: "rejected-before-copy" }
      : { kind: "uncertain" };
  }
  const submission = savedDraftSubmissionOutcome(
    client,
    response,
    context.accountId,
    copy.emailId,
    copy.state,
  );
  return submission === "accepted"
    ? { copy, kind: "accepted" }
    : submission === "retryable"
      ? { copy, kind: "rejected" }
      : { copy, kind: "uncertain" };
};
