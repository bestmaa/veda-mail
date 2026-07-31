import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SavedProviderDraft } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import { RECOVER_DRAFT_BEFORE_SEND_MESSAGE } from "@/presentation/features/mail-workspace/composer-draft-state";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
}));
vi.mock("@/transport/client/api-client", () => ({
  mailApi: { sendMessage },
}));

import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";

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
      onSent: vi.fn(),
      openAccountKey: "account-a",
      providerDraft,
      resetFields: vi.fn(),
      restoreFocus: vi.fn(),
      setError,
      setIsOpen: vi.fn(),
      setIsSending: vi.fn(),
    });

    await (submit({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>) as unknown as Promise<void>);

    expect(setError).toHaveBeenCalledWith(SAVED_DRAFT_ATTACHMENT_SEND_MESSAGE);
    expect(sendMessage).not.toHaveBeenCalled();
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
      onSent: vi.fn(),
      openAccountKey: "account-a",
      providerDraft: null,
      resetFields: vi.fn(),
      restoreFocus: vi.fn(),
      setError,
      setIsOpen: vi.fn(),
      setIsSending: vi.fn(),
    });

    await (submit({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>) as unknown as Promise<void>);
    expect(setError).toHaveBeenCalledWith(RECOVER_DRAFT_BEFORE_SEND_MESSAGE);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
