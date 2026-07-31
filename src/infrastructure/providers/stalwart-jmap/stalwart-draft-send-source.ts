import "server-only";

import type { SavedProviderDraft } from "@/domain/mail/draft";
import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftHasAttachmentsError,
} from "@/domain/mail/draft-errors";
import {
  assertDraftRevision,
  canonicalDraftComposeId,
} from "@/domain/mail/draft-validation";
import type {
  StalwartDraftContext,
  StalwartDraftReader,
  StalwartDraftRecord,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-draft.reader";

export interface StalwartDraftSendSource {
  readonly context: StalwartDraftContext;
  readonly record: StalwartDraftRecord;
}

export const prepareStalwartDraftSendSource = async (
  drafts: StalwartDraftReader,
  source: SavedProviderDraft,
): Promise<StalwartDraftSendSource> => {
  const context = await drafts.context();
  const record = await drafts.load(context, source.id);
  const unique = await drafts.findByComposeId(
    context,
    canonicalDraftComposeId(source.composeId),
  );
  if (
    unique?.detail.id !== record.detail.id ||
    record.detail.revision !== assertDraftRevision(source.expectedRevision) ||
    record.detail.composeId !== canonicalDraftComposeId(source.composeId)
  ) {
    throw new DraftConflictError();
  }
  if (record.detail.hasAttachments) throw new DraftHasAttachmentsError();
  if (record.detail.hasUncertainSubmission) throw new DraftConflictError();
  if (record.detail.hasTruncatedContent) {
    throw new DraftContentTruncatedError();
  }
  return { context, record };
};
