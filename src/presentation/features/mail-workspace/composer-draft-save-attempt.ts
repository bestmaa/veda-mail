import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { DraftId } from "@/domain/shared/brand";
import { mailApi } from "@/transport/client/api-client";

export interface ComposerDraftSaveAttempt {
  readonly attachmentIds?: readonly string[];
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly contentGeneration: number;
  readonly expectedRevision?: string;
  readonly providerDraftId?: DraftDetail["id"];
  readonly retainedAttachmentIds?: readonly string[];
}

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
  attachmentIds: readonly string[] = [],
  retainedAttachmentIds: readonly string[] = [],
): ComposerDraftSaveAttempt => {
  const snapshot = snapshotContent(content);
  return saved
    ? {
        composeId,
        content: snapshot,
        contentGeneration,
        attachmentIds: [...attachmentIds],
        expectedRevision: saved.revision,
        providerDraftId: saved.id,
        retainedAttachmentIds: [...retainedAttachmentIds],
      }
    : {
        attachmentIds: [...attachmentIds],
        composeId,
        content: snapshot,
        contentGeneration,
        retainedAttachmentIds: [],
      };
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
        expectedRevision: attempt.expectedRevision!,
        attachmentIds: attempt.attachmentIds ?? [],
        retainedAttachmentIds: attempt.retainedAttachmentIds ?? [],
      },
      accountKey,
      signal,
    )
  : mailApi.createDraft(
      attempt.composeId,
      attempt.content,
      accountKey,
      signal,
      { attachmentIds: attempt.attachmentIds ?? [] },
    );
