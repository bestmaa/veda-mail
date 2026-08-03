import "server-only";

import type { ProviderDraftId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { SavedDraftSubmissionContext } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim";
import { verifyAndRepairStalwartSentState } from "@/infrastructure/providers/stalwart-jmap/stalwart-send-cleanup";

export const repairSavedDraftSentState = (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  emailId: ProviderDraftId,
  cleanupPatch: Readonly<Record<string, null>>,
): Promise<boolean> =>
  verifyAndRepairStalwartSentState(client, context.accountId, emailId, {
    draftMailboxId: context.draftMailboxId,
    removeKeywords: Object.keys(cleanupPatch).map((path) =>
      path.slice("keywords/".length),
    ),
    sentMailboxId: context.sentMailboxId,
  });
