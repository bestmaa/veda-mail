import { ApiClientError } from "@/transport/client/api-request";
import type { DraftDetail } from "@/domain/mail/draft";

export type ComposerDraftPhase =
  | "conflict"
  | "error"
  | "saved"
  | "saving"
  | "unsaved";

export const LOCAL_ATTACHMENT_DRAFT_MESSAGE =
  "Remove local attachments before saving this provider draft.";
export const PROVIDER_ATTACHMENT_DRAFT_MESSAGE =
  "Drafts with provider attachments cannot be edited yet. The saved draft was not changed.";
export const TRUNCATED_PROVIDER_DRAFT_MESSAGE =
  "This provider draft contains incomplete or unsupported content and cannot be edited safely. The saved draft was not changed.";
export const UNCERTAIN_PROVIDER_DRAFT_MESSAGE =
  "This draft has an uncertain send outcome. Check Sent before continuing. You can copy its content or explicitly discard it.";
export const SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE =
  "Remove local attachments before sending this saved provider draft.";
export const SAVE_CHANGES_BEFORE_SEND_MESSAGE =
  "Save changes before sending this provider draft.";
export const SAVE_IMPORTED_DRAFT_MESSAGE =
  "Save this imported provider draft before sending.";
export const RELOAD_DRAFT_BEFORE_SEND_MESSAGE =
  "Reload this provider draft before sending.";
export const RECOVER_DRAFT_BEFORE_SEND_MESSAGE =
  "Recover this provider draft before sending or discarding it.";
export const DRAFT_RECOVERY_CONFLICT_MESSAGE =
  "The provider draft changed and could not be recovered. Your local changes are still here. Copy them, then close and reopen the draft from Drafts.";

export const draftRequestAborted = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

export const draftFailureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to save this draft.";

export const isDraftConflict = (error: unknown): boolean =>
  error instanceof ApiClientError &&
  (error.status === 409 || error.code === "MAIL_DRAFT_CONFLICT");

export const completeDraftSave = (
  startedAtContentGeneration: number,
  currentContentGeneration: number,
): { readonly isDirty: boolean; readonly phase: ComposerDraftPhase } => {
  const isDirty = currentContentGeneration !== startedAtContentGeneration;
  return { isDirty, phase: isDirty ? "unsaved" : "saved" };
};

export const providerDraftEditBlock = (
  draft: DraftDetail | null,
): string | null => draft?.hasUncertainSubmission
  ? UNCERTAIN_PROVIDER_DRAFT_MESSAGE
  : draft?.hasAttachments
    ? PROVIDER_ATTACHMENT_DRAFT_MESSAGE
    : draft?.hasTruncatedContent
      ? TRUNCATED_PROVIDER_DRAFT_MESSAGE
      : null;

export const composerDraftAvailability = ({
  hasLocalAttachments,
  isDirty,
  providerDraftRequested,
  requiresRecovery,
  saved,
}: {
  readonly hasLocalAttachments: boolean;
  readonly isDirty: boolean;
  readonly providerDraftRequested: boolean;
  readonly requiresRecovery: boolean;
  readonly saved: DraftDetail | null;
}) => {
  const canEdit = !saved?.hasUncertainSubmission &&
    !saved?.hasAttachments && !saved?.hasTruncatedContent &&
    !(providerDraftRequested && !saved);
  const imported = saved?.composeId === null;
  const canSave = !requiresRecovery && canEdit &&
    (isDirty || hasLocalAttachments || imported);
  const canSend = !requiresRecovery && !providerDraftRequested && !saved
    ? true
    : !requiresRecovery && canEdit && Boolean(saved?.composeId) && !isDirty && !hasLocalAttachments;
  const sendBlockedMessage = canSend
    ? null
    : requiresRecovery
      ? RECOVER_DRAFT_BEFORE_SEND_MESSAGE
      : providerDraftRequested && !saved
      ? RELOAD_DRAFT_BEFORE_SEND_MESSAGE
      : imported
        ? SAVE_IMPORTED_DRAFT_MESSAGE
        : hasLocalAttachments
          ? SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE
          : isDirty
            ? SAVE_CHANGES_BEFORE_SEND_MESSAGE
            : null;
  return {
    canDiscard: !requiresRecovery && !(providerDraftRequested && !saved),
    canEdit, canSave, canSend, sendBlockedMessage,
  };
};
