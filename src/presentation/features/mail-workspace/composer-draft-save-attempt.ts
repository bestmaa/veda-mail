import type {
  DraftContent,
  DraftDetail,
  DraftSaveInput,
} from "@/domain/mail/draft";
import type { DraftId } from "@/domain/shared/brand";
import { mailApi } from "@/transport/client/api-client";

export type ComposerDraftSaveAttempt = DraftSaveInput & {
  readonly contentGeneration: number;
};

const snapshotContent = (content: DraftContent): DraftContent => ({
  bcc: content.bcc.map((address) => ({ ...address })),
  body: content.body,
  cc: content.cc.map((address) => ({ ...address })),
  ...(content.htmlBody === undefined ? {} : { htmlBody: content.htmlBody }),
  ...(content.inReplyTo === undefined ? {} : { inReplyTo: content.inReplyTo }),
  subject: content.subject,
  to: content.to.map((address) => ({ ...address })),
});

export const composerDraftSaveAttempt = (
  composeId: DraftId,
  content: DraftContent,
  contentGeneration: number,
  saved: DraftDetail | null,
): ComposerDraftSaveAttempt => {
  const snapshot = snapshotContent(content);
  return saved
    ? {
        composeId,
        content: snapshot,
        contentGeneration,
        expectedRevision: saved.revision,
        providerDraftId: saved.id,
      }
    : { composeId, content: snapshot, contentGeneration };
};

export const issueComposerDraftSaveAttempt = (
  attempt: ComposerDraftSaveAttempt,
  accountKey: string,
  signal: AbortSignal,
): Promise<DraftDetail> => attempt.providerDraftId
  ? mailApi.updateDraft(
      attempt.providerDraftId,
      {
        composeId: attempt.composeId,
        content: attempt.content,
        expectedRevision: attempt.expectedRevision,
      },
      accountKey,
      signal,
    )
  : mailApi.createDraft(
      attempt.composeId,
      attempt.content,
      accountKey,
      signal,
    );
