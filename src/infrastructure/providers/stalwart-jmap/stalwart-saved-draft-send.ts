import "server-only";

import type { SendMessageInput, SendReceipt } from "@/domain/mail/mail";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import { hasCanonicalDraftContent } from "@/domain/mail/draft-content-round-trip";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  hasLosslessDraftHeaders,
  hasSupportedDraftHeaderInventory,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-header-safety";
import { matchesStoredJmapDraftContent } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.mapper";
import { assertStalwartDraftComposeMembers } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-compose-members";
import { hasSupportedDraftBodyStructure } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-mime-safety";
import type { StalwartDraftSendSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-send-source";
import {
  destroyClaimedStalwartDraft,
  releaseClaimedStalwartDraft,
  type ClaimedDraft,
  type SavedDraftSubmissionContext,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim";
import {
  claimStalwartSavedDraft,
  loadClaimedStalwartDraft,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-claim-acquire";
import { sendClaimedStalwartDraft } from "@/infrastructure/providers/stalwart-jmap/stalwart-saved-draft-replacement";
import { sameStoredJmapDraftAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft-attachments";
import type { StalwartDraftRecord } from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";
import { logError } from "@/server/observability/structured-log";

const uncertainReceipt = (
  source: StalwartDraftSendSource,
  messageId = id.message(source.record.detail.id),
): SendReceipt => ({
  deliveryStatus: "uncertain",
  id: messageId,
  rejectedRecipients: [],
  submittedAt: new Date().toISOString(),
});

const assertTrustedSource = (
  input: SendMessageInput,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
  expected: StalwartDraftRecord = source.record,
): void => {
  const from = source.record.email.from ?? [];
  if (
    source.context.accountId !== context.accountId ||
    source.context.draftsMailboxId !== context.draftMailboxId ||
    from.length !== 1 ||
    from[0]?.email.toLowerCase() !== context.identity.email.toLowerCase() ||
    (input.attachments?.length ?? 0) > 0 ||
    source.record.detail.hasTruncatedContent ||
    source.record.detail.hasUncertainSubmission ||
    !hasCanonicalDraftContent(source.record.detail.content) ||
    !hasLosslessDraftHeaders(source.record.email) ||
    !hasSupportedDraftHeaderInventory(source.record.email) ||
    !hasSupportedDraftBodyStructure(source.record.email) ||
    (source.record.email.replyTo?.length ?? 0) > 0 ||
    (source.record.email.sender?.length ?? 0) > 0 ||
    !matchesStoredJmapDraftContent(
      source.record.email,
      source.record.detail.content,
      input,
    ) ||
    !sameStoredJmapDraftAttachments(
      source.context.accountId,
      expected.email,
      source.record.email,
    )
  ) {
    throw new DraftConflictError();
  }
};

const acquireClaim = async (
  client: StalwartJmapClient,
  input: SendMessageInput,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
  reload?: () => Promise<StalwartDraftSendSource>,
): Promise<ClaimedDraft | SendReceipt> => {
  let trusted = source;
  const expected = source.record;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertTrustedSource(input, trusted, context, expected);
    const outcome = await claimStalwartSavedDraft(client, trusted, context);
    if (outcome.kind === "claimed") {
      try {
        assertTrustedSource(input, outcome.value.source, context, expected);
        return outcome.value;
      } catch {
        return uncertainReceipt(trusted);
      }
    }
    if (outcome.kind === "uncertain") return uncertainReceipt(trusted);
    if (attempt > 0 || !reload) throw new DraftConflictError();
    trusted = await reload();
  }
  throw new DraftConflictError();
};

const rejectedAfterCopy = async (
  client: StalwartJmapClient,
  context: SavedDraftSubmissionContext,
  claimed: ClaimedDraft,
  copy: {
    readonly emailId: ReturnType<typeof id.providerDraft>;
    readonly state: string;
  },
): Promise<boolean> => {
  try {
    const destroyed = await destroyClaimedStalwartDraft(
      client,
      context,
      copy.emailId,
      claimed.claimKeyword,
      copy.state,
    );
    return destroyed && releaseClaimedStalwartDraft(client, context, claimed);
  } catch {
    return false;
  }
};

export const submitStalwartSavedDraft = async (
  client: StalwartJmapClient,
  input: SendMessageInput,
  source: StalwartDraftSendSource,
  context: SavedDraftSubmissionContext,
  reload?: () => Promise<StalwartDraftSendSource>,
): Promise<SendReceipt> => {
  const acquired = await acquireClaim(client, input, source, context, reload);
  if ("deliveryStatus" in acquired) return acquired;
  let claimed = acquired;
  try {
    await assertStalwartDraftComposeMembers(
      client,
      claimed.source.context,
      claimed.source.record.detail.composeId,
      [claimed.source.record.detail.id],
    );
  } catch {
    return uncertainReceipt(claimed.source);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await sendClaimedStalwartDraft(
      client,
      input,
      claimed,
      context,
    );
    if (outcome.kind === "retry") {
      if (attempt > 0) return uncertainReceipt(claimed.source);
      try {
        const expected = claimed.source.record;
        const fresh = await loadClaimedStalwartDraft(
          client,
          context,
          claimed.source.record.detail.id,
          claimed.claimKeyword,
        );
        if (!fresh) return uncertainReceipt(claimed.source);
        claimed = { ...claimed, source: fresh };
        assertTrustedSource(input, fresh, context, expected);
        await assertStalwartDraftComposeMembers(
          client,
          fresh.context,
          fresh.record.detail.composeId,
          [fresh.record.detail.id],
        );
      } catch {
        return uncertainReceipt(claimed.source);
      }
      continue;
    }
    if (outcome.kind === "accepted") {
      try {
        const cleaned = await destroyClaimedStalwartDraft(
          client,
          context,
          claimed.source.record.detail.id,
          claimed.claimKeyword,
          claimed.source.record.state,
          claimed.source.record,
        );
        if (!cleaned) {
          logError("provider.stalwart_draft_cleanup_failed", {
            outcome: "error",
            providerId: "stalwart-jmap",
          });
        }
      } catch {
        logError("provider.stalwart_draft_cleanup_failed", {
          outcome: "error",
          providerId: "stalwart-jmap",
        });
      }
      return {
        deliveryStatus: "accepted",
        id: id.message(outcome.copy.emailId),
        rejectedRecipients: [],
        submittedAt: new Date().toISOString(),
      };
    }
    if (outcome.kind === "rejected") {
      if (await rejectedAfterCopy(client, context, claimed, outcome.copy)) {
        throw new Error("Stalwart did not submit the saved draft.");
      }
      return uncertainReceipt(claimed.source);
    }
    if (
      outcome.kind === "rejected-before-copy" ||
      outcome.kind === "not-executed"
    ) {
      if (await releaseClaimedStalwartDraft(client, context, claimed)) {
        if (outcome.kind === "not-executed") throw outcome.error;
        throw new Error("Stalwart did not submit the saved draft.");
      }
    }
    return uncertainReceipt(
      claimed.source,
      outcome.kind === "uncertain" && outcome.copy
        ? id.message(outcome.copy.emailId)
        : undefined,
    );
  }
  return uncertainReceipt(claimed.source);
};
