import { describe, expect, it, vi } from "vitest";

import type { SavedProviderDraft } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import { RECOVER_DRAFT_BEFORE_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import type {
  ComposerRecoveryCheckpoint,
  ComposerRecoveryJournalPort,
} from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";

const api = vi.hoisted(() => ({ scheduleMessage: vi.fn(), sendMessage: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useRef: <T,>(current: T) => ({ current }),
}));
vi.mock("@/transport/client/api-client", () => ({
  mailApi: api,
}));

import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";

const recovery = {} as ComposerRecoveryJournalPort;
const recoveryCheckpoint = {} as ComposerRecoveryCheckpoint;

describe("saved provider draft submit", () => {
  it("does not orphan a saved draft by sending local attachments without its provider reference", async () => {
    const discard = vi.fn();
    const setError = vi.fn();
    const providerDraft: SavedProviderDraft = {
      composeId: id.draft("compose-a"),
      expectedRevision: "revision-a",
      id: id.providerDraft("provider-a"),
    };
    const attachments = {
      attachmentIds: [id.attachmentUpload("upload-a")],
      discard,
      draftId: providerDraft.composeId,
      expireReady: () => false,
      hasError: false,
      isUploading: false,
    } as unknown as ReturnType<typeof useComposerAttachments>;
    const body = {
      payload: { body: "Ready to send" },
      text: "Ready to send",
    } as ReturnType<typeof useComposerBody>;
    const fields = {
      bcc: "",
      cc: "",
      inReplyTo: undefined,
      subject: "Subject",
      to: "recipient@example.com",
    } as ReturnType<typeof useComposerFields>;
    const submit = useComposerSubmit({
      attachments,
      body,
      draftSendBlockedMessage: null,
      fields,
      handleSessionFailure: () => false,
      isAccountCurrent: () => true,
      isDraftBusy: false,
      isDraftReadOnly: false,
      onDraftSent: vi.fn(),
      onSendUncertain: vi.fn(),
      onSent: vi.fn(),
      openAccountKey: "account-a",
      providerDraft,
      recovery, recoveryCheckpoint,
      resetFields: vi.fn(),
      restoreFocus: vi.fn(),
      setError,
      setIsOpen: vi.fn(),
      setIsSending: vi.fn(),
    });

    await submit();

    expect(setError).toHaveBeenCalledWith(SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
  });

  it("does not submit after an ambiguous save failure", async () => {
    const setError = vi.fn();
    const submit = useComposerSubmit({
      attachments: {} as ReturnType<typeof useComposerAttachments>,
      body: {} as ReturnType<typeof useComposerBody>,
      draftSendBlockedMessage: RECOVER_DRAFT_BEFORE_SEND_MESSAGE,
      fields: {} as ReturnType<typeof useComposerFields>,
      handleSessionFailure: () => false,
      isAccountCurrent: () => true,
      isDraftBusy: false,
      isDraftReadOnly: false,
      onDraftSent: vi.fn(),
      onSendUncertain: vi.fn(),
      onSent: vi.fn(),
      openAccountKey: "account-a",
      providerDraft: null,
      recovery, recoveryCheckpoint,
      resetFields: vi.fn(),
      restoreFocus: vi.fn(),
      setError,
      setIsOpen: vi.fn(),
      setIsSending: vi.fn(),
    });

    await submit();
    expect(setError).toHaveBeenCalledWith(RECOVER_DRAFT_BEFORE_SEND_MESSAGE);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("saves an exact provider draft and queues an undo job without immediate delivery", async () => {
    const providerDraftId = id.providerDraft("provider-undo");
    const scheduledMessage = {
      attemptCount: 0, createdAt: new Date().toISOString(),
      id: id.scheduledMessage("11111111-1111-4111-8111-111111111111"),
      lastError: null, purpose: "undo" as const, recipientCount: 1,
      scheduledAt: new Date(Date.now() + 5_000).toISOString(),
      status: "pending" as const, subject: "Undo subject",
      updatedAt: new Date().toISOString(),
    };
    api.scheduleMessage.mockResolvedValueOnce({
      createdMessage: scheduledMessage, messages: [scheduledMessage],
      revision: "revision", version: 1,
    });
    const saveDraft = vi.fn().mockResolvedValue({
      attachments: [], composeId: id.draft("compose-undo"),
      content: { bcc: [], body: "Body", cc: [], subject: "Undo subject", to: [] },
      hasAttachments: false, hasTruncatedContent: false,
      hasUncertainSubmission: false, id: providerDraftId,
      revision: "provider-revision", updatedAt: new Date().toISOString(),
    });
    const onUndoQueued = vi.fn();
    const submit = useComposerSubmit({
      attachments: {
        attachmentIds: [], draftId: id.draft("compose-undo"),
        expireReady: () => false, hasError: false, isUploading: false,
      } as unknown as ReturnType<typeof useComposerAttachments>,
      body: { payload: { body: "Body" }, text: "Body" } as ReturnType<typeof useComposerBody>,
      draftSendBlockedMessage: null,
      fields: { bcc: "", cc: "", inReplyTo: undefined, subject: "Undo subject",
        to: "recipient@example.com" } as ReturnType<typeof useComposerFields>,
      handleSessionFailure: () => false, isAccountCurrent: () => true,
      isDraftBusy: false, isDraftReadOnly: false, onDraftSent: vi.fn(),
      onSendUncertain: vi.fn(), onSent: vi.fn(), onUndoQueued,
      openAccountKey: "scope-a", providerDraft: null, recovery,
      recoveryCheckpoint, resetFields: vi.fn(), restoreFocus: vi.fn(), saveDraft,
      setError: vi.fn(), setIsOpen: vi.fn(), setIsSending: vi.fn(),
      undoSendSeconds: 5,
    });

    await Promise.all([submit(), submit()]);

    expect(saveDraft).toHaveBeenCalledOnce();
    expect(api.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentIds: [], expectedDraftRevision: "provider-revision",
        providerDraftId, subject: "Undo subject",
      }),
      expect.any(String), "scope-a", "undo",
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(onUndoQueued).toHaveBeenCalledWith(scheduledMessage, providerDraftId);
  });
});
