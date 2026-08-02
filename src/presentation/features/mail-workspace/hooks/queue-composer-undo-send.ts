import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type { UndoSendDelay } from "@/domain/mail/message-list-preferences";
import type { ScheduleMessageResult } from "@/domain/mail/scheduled-send";
import { mailApi } from "@/transport/client/api-client";

interface QueueComposerUndoSendOptions {
  readonly content: DraftContent;
  readonly saveDraft: () => Promise<DraftDetail | null>;
  readonly seconds: Exclude<UndoSendDelay, 0>;
  readonly sessionScope: string;
}

export interface QueuedComposerUndoSend {
  readonly providerDraftId: DraftDetail["id"];
  readonly result: ScheduleMessageResult;
}

export const queueComposerUndoSend = async ({
  content,
  saveDraft,
  seconds,
  sessionScope,
}: QueueComposerUndoSendOptions): Promise<QueuedComposerUndoSend | null> => {
  const saved = await saveDraft();
  if (!saved?.composeId) return null;
  const scheduledAt = new Date(Date.now() + seconds * 1_000).toISOString();
  const result = await mailApi.scheduleMessage({
    attachmentIds: [],
    ...content,
    draftId: saved.composeId,
    expectedDraftRevision: saved.revision,
    providerDraftId: saved.id,
  }, scheduledAt, sessionScope, "undo");
  return { providerDraftId: saved.id, result };
};
