import "server-only";

import type { DraftDetail } from "@/domain/mail/draft";
import {
  sameCanonicalDraftContent,
} from "@/domain/mail/draft-content-round-trip";
import { DraftConflictError } from "@/domain/mail/draft-errors";
import type {
  ScheduledMessageOwner,
  ScheduledSendRequest,
} from "@/domain/mail/scheduled-send";
import type { ProviderConnection } from "@/domain/provider/provider";
import { getMailService } from "@/server/mail/mail-service";
import { canonicalizeOutgoingMailContent } from "@/server/mail/outgoing-mail-content";

export const scheduledMessageOwner = async (
  connection: ProviderConnection,
): Promise<ScheduledMessageOwner> => {
  const account = await (await getMailService(connection)).getAccount();
  return { email: account.email, providerId: account.providerId };
};

export const canonicalScheduledRequest = (
  request: ScheduledSendRequest,
): ScheduledSendRequest => {
  const content = canonicalizeOutgoingMailContent(request);
  return {
    bcc: request.bcc,
    body: content.body,
    cc: request.cc,
    draftId: request.draftId,
    expectedDraftRevision: request.expectedDraftRevision,
    ...(content.htmlBody ? { htmlBody: content.htmlBody } : {}),
    ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
    providerDraftId: request.providerDraftId,
    subject: request.subject,
    to: request.to,
  };
};

export const assertSchedulableProviderDraft = (
  draft: DraftDetail,
  request: ScheduledSendRequest,
): void => {
  if (
    draft.id !== request.providerDraftId ||
    draft.composeId !== request.draftId ||
    draft.revision !== request.expectedDraftRevision ||
    draft.hasTruncatedContent ||
    draft.hasUncertainSubmission ||
    !sameCanonicalDraftContent(draft.content, request)
  ) {
    throw new DraftConflictError();
  }
};
