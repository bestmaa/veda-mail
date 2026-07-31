import "server-only";

import type { z } from "zod";

import {
  DraftConflictError,
  DraftNotFoundError,
} from "@/domain/mail/draft-errors";
import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  StalwartJmapHttpError,
  StalwartJmapMethodError,
  type StalwartJmapRequestBoundary,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { loadStalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { VEDA_SEND_CLAIM_KEYWORD_PREFIX } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-fingerprint";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-send-source";
import type {
  ClaimedDraft,
  SavedDraftSubmissionContext,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { jmapKeywordBooleanRecordSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-record.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

export type ClaimDraftOutcome =
  | { readonly kind: "claimed"; readonly value: ClaimedDraft }
  | { readonly kind: "retry" | "uncertain" };

type SetResult = z.infer<typeof jmapSetResultSchema>;
const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);
const noFailures = (result: SetResult): boolean =>
  [result.notCreated, result.notDestroyed, result.notUpdated].every(
    (value) => Object.keys(value ?? {}).length === 0,
  );
const strictUpdate = (
  result: SetResult,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
): string | null =>
  result.accountId === context.accountId &&
  hasAdvancedJmapSetState(result, source.record.state) &&
  exact(Object.keys(result.updated ?? {}), [source.record.detail.id]) &&
  Object.keys(result.created ?? {}).length === 0 &&
  (result.destroyed?.length ?? 0) === 0 &&
  noFailures(result)
    ? (result.newState as string)
    : null;

export const loadClaimedStalwartDraft = async (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  emailId: ProviderDraftId,
  claimKeyword: string,
): Promise<StalwartDraftSendSource | null> => {
  try {
    const record = await loadStalwartDraftRecord(
      client,
      {
        accountId: context.accountId,
        accountEmail: context.identity.email,
        draftsMailboxId: context.draftMailboxId,
      },
      emailId,
      claimKeyword,
    );
    return {
      context: {
        accountId: context.accountId,
        draftsMailboxId: context.draftMailboxId,
      },
      record,
    };
  } catch (error) {
    if (error instanceof DraftNotFoundError) return null;
    throw error;
  }
};

const reconcileClaim = async (
  client: StalwartJmapClient,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
  claimKeyword: string,
): Promise<ClaimDraftOutcome> => {
  try {
    const reconciled = await loadClaimedStalwartDraft(
      client,
      context,
      source.record.detail.id,
      claimKeyword,
    );
    return reconciled
      ? { kind: "claimed", value: { claimKeyword, source: reconciled } }
      : { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
};

export const claimStalwartSavedDraft = async (
  client: StalwartJmapClient,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
): Promise<ClaimDraftOutcome> => {
  const claimKeyword = `${VEDA_SEND_CLAIM_KEYWORD_PREFIX}${crypto.randomUUID()}`;
  if (
    !jmapKeywordBooleanRecordSchema.safeParse({
      ...source.record.email.keywords,
      [claimKeyword]: true,
    }).success
  ) {
    throw new DraftConflictError();
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
            ifInState: source.record.state,
            update: {
              [source.record.detail.id]: {
                [`keywords/${claimKeyword}`]: true,
              },
            },
          },
          "claim-saved-draft",
        ],
      ],
      [JMAP_MAIL],
      undefined,
      boundary,
    );
  } catch (error) {
    if (
      !boundary.issued ||
      (error instanceof StalwartJmapHttpError && error.methodsWereNotExecuted)
    ) {
      throw error;
    }
    return reconcileClaim(client, source, context, claimKeyword);
  }
  try {
    const result = client.result(
      response,
      "claim-saved-draft",
      "Email/set",
      jmapSetResultSchema,
    );
    const state = strictUpdate(result, source, context);
    if (!state) return reconcileClaim(client, source, context, claimKeyword);
    if (result.updated?.[source.record.detail.id] !== null) {
      return reconcileClaim(client, source, context, claimKeyword);
    }
    return {
      kind: "claimed",
      value: {
        claimKeyword,
        source: {
          ...source,
          record: {
            ...source.record,
            email: {
              ...source.record.email,
              keywords: {
                ...source.record.email.keywords,
                [claimKeyword]: true,
              },
            },
            state,
          },
        },
      },
    };
  } catch (error) {
    if (
      error instanceof StalwartJmapMethodError &&
      error.type === "stateMismatch"
    ) {
      return { kind: "retry" };
    }
    if (
      error instanceof StalwartJmapMethodError &&
      error.kind === "definitive"
    ) {
      throw error;
    }
    return reconcileClaim(client, source, context, claimKeyword);
  }
};
