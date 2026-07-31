import "server-only";

import type { z } from "zod";

import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { isStalwartDraftPresent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import type { StalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-record-reader";
import { sameDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { assertUnchangedDraftMetadata } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-replacement";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-send-source";
import { loadClaimedStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim-acquire";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { hasAdvancedJmapSetState } from "@/infrastructure/providers/stalwart-jmap/stalwart-set-state";

export interface SavedDraftSubmissionContext {
  readonly accountId: string;
  readonly draftMailboxId: string;
  readonly identity: {
    readonly email: string;
    readonly id: string;
    readonly name?: string | undefined;
  };
  readonly sentMailboxId: string;
}

export interface ClaimedDraft {
  readonly claimKeyword: string;
  readonly source: StalwartDraftSendSource;
}

type SetResult = z.infer<typeof jmapSetResultSchema>;
const exact = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length &&
  actual.every((value, index) => value === expected[index]);
const noFailures = (result: SetResult): boolean =>
  [result.notCreated, result.notDestroyed, result.notUpdated].every(
    (value) => Object.keys(value ?? {}).length === 0,
  );

const mutateClaimedDraft = async (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  emailId: ProviderDraftId,
  claimKeyword: string,
  initialState: string,
  action: "destroy" | "release",
  expected?: StalwartDraftRecord,
): Promise<boolean> => {
  let state = initialState;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await client.request(
        [
          [
            "Email/set",
            {
              accountId: context.accountId,
              ...(action === "destroy"
                ? { destroy: [emailId] }
                : {
                    update: {
                      [emailId]: { [`keywords/${claimKeyword}`]: null },
                    },
                  }),
              ifInState: state,
            },
            `${action}-claimed-draft`,
          ],
        ],
        [JMAP_MAIL],
      );
      const result = client.result(
        response,
        `${action}-claimed-draft`,
        "Email/set",
        jmapSetResultSchema,
      );
      const base =
        result.accountId === context.accountId &&
        hasAdvancedJmapSetState(result, state) &&
        Object.keys(result.created ?? {}).length === 0 &&
        noFailures(result);
      return action === "release"
        ? base &&
            exact(Object.keys(result.updated ?? {}), [emailId]) &&
            (result.destroyed?.length ?? 0) === 0
        : base &&
            exact(result.destroyed ?? [], [emailId]) &&
            Object.keys(result.updated ?? {}).length === 0;
    } catch (error) {
      const stateMismatch =
        error instanceof StalwartJmapMethodError &&
        error.type === "stateMismatch";
      if (!stateMismatch || attempt > 0) return false;
      try {
        const fresh = await loadClaimedStalwartDraft(
          client,
          context,
          emailId,
          claimKeyword,
        );
        if (!fresh) {
          return action === "destroy"
            ? !(await isStalwartDraftPresent(
                client,
                {
                  accountId: context.accountId,
                  draftsMailboxId: context.draftMailboxId,
                },
                emailId,
              ))
            : false;
        }
        if (expected) {
          try {
            assertUnchangedDraftMetadata(expected, fresh.record);
          } catch {
            return false;
          }
          if (
            !sameDraftContent(
              expected.detail.content,
              fresh.record.detail.content,
            )
          ) {
            return false;
          }
        }
        state = fresh.record.state;
      } catch {
        return false;
      }
    }
  }
  return false;
};

export const destroyClaimedStalwartDraft = (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  emailId: ProviderDraftId,
  claimKeyword: string,
  state: string,
  expected?: StalwartDraftRecord,
): Promise<boolean> =>
  mutateClaimedDraft(
    client,
    context,
    emailId,
    claimKeyword,
    state,
    "destroy",
    expected,
  );

export const releaseClaimedStalwartDraft = (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  claimed: ClaimedDraft,
): Promise<boolean> =>
  mutateClaimedDraft(
    client,
    context,
    claimed.source.record.detail.id,
    claimed.claimKeyword,
    claimed.source.record.state,
    "release",
  );
