import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import { ApiClientError } from "@/transport/client/api-request";
import { recoverySnapshot } from "./composer-recovery-fixture";

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useRef: <T,>(current: T) => ({ current }),
}));
vi.mock("@/transport/client/api-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mailApi: { sendMessage },
}));

import { useComposerSubmit } from "@/presentation/features/mail-workspace/hooks/use-composer-submit";

const composeId = id.draft("compose-terminal-a");
const intentId = "55555555-5555-4555-8555-555555555555";
const receipt = {
  deliveryStatus: "accepted" as const,
  id: id.message("message-a"),
  rejectedRecipients: [],
  submittedAt: "2026-07-31T12:00:00.000Z",
};

const setup = () => {
  const prepareSend = vi.fn(async (request) => ({
    intentId,
    request: { ...request, body: "Canonical terminal body" },
  }));
  const recovery = {
    completeTerminal: vi.fn().mockResolvedValue(true),
    markSendUncertain: vi.fn().mockResolvedValue(true),
    prepareSend,
    rejectTerminal: vi.fn().mockResolvedValue(true),
  } as unknown as ComposerRecoveryJournalPort;
  const attachments = {
    attachmentIds: [], discard: vi.fn(), draftId: composeId,
    expireReady: () => false, hasError: false, invalidateReady: vi.fn(),
    isUploading: false,
  } as unknown as ReturnType<typeof useComposerAttachments>;
  const body = {
    payload: { body: "Original body" }, text: "Original body",
  } as ReturnType<typeof useComposerBody>;
  const fields = {
    bcc: "", cc: "", inReplyTo: undefined, subject: "Subject",
    to: "person@example.com",
  } as ReturnType<typeof useComposerFields>;
  const actions = {
    onDraftSent: vi.fn(), onSendUncertain: vi.fn(), onSent: vi.fn(), setError: vi.fn(),
    setIsOpen: vi.fn(), setIsSending: vi.fn(),
  };
  const submit = useComposerSubmit({
    attachments, body, draftSendBlockedMessage: null, fields,
    handleSessionFailure: () => false, isAccountCurrent: () => true,
    isDraftBusy: false, isDraftReadOnly: false,
    onDraftSent: actions.onDraftSent,
    onSendUncertain: actions.onSendUncertain, onSent: actions.onSent,
    openAccountKey: "scope-a", providerDraft: null, recovery,
    recoveryCheckpoint: { composeId, generation: 1, snapshot: recoverySnapshot() },
    resetFields: vi.fn(), restoreFocus: vi.fn(), setError: actions.setError,
    setIsOpen: actions.setIsOpen, setIsSending: actions.setIsSending,
  });
  return { actions, prepareSend, recovery, submit };
};

const invoke = (submit: ReturnType<typeof useComposerSubmit>) => submit();

beforeEach(() => sendMessage.mockReset());

describe("composer terminal send recovery", () => {
  it("secures and uses the exact canonical in-memory request before HTTP", async () => {
    const harness = setup();
    sendMessage.mockImplementationOnce(async (request) => {
      expect(harness.prepareSend).toHaveBeenCalledOnce();
      expect(request.body).toBe("Canonical terminal body");
      return receipt;
    });

    await invoke(harness.submit);

    expect(harness.recovery.completeTerminal).toHaveBeenCalledWith(intentId);
    expect(harness.actions.onDraftSent).toHaveBeenCalledOnce();
    expect(harness.actions.onSent).toHaveBeenCalledWith(
      receipt, ["person@example.com"],
    );
  });

  it("marks an ambiguous HTTP outcome and never rejects its send marker", async () => {
    const harness = setup();
    sendMessage.mockRejectedValueOnce(new Error("Connection lost"));
    await invoke(harness.submit);

    expect(harness.recovery.markSendUncertain).toHaveBeenCalledWith(intentId);
    expect(harness.recovery.rejectTerminal).not.toHaveBeenCalled();
    expect(harness.actions.onDraftSent).not.toHaveBeenCalled();
    expect(harness.actions.onSendUncertain).toHaveBeenCalledOnce();
  });

  it.each([
    new ApiClientError("Timed out", 408, "REQUEST_TIMEOUT"),
    new ApiClientError("Session ended", 409, "MAIL_SEND_SESSION_ENDED"),
  ])("blocks resend for an ambiguous terminal API response", async (error) => {
    const harness = setup();
    sendMessage.mockRejectedValueOnce(error);
    await invoke(harness.submit);

    expect(harness.recovery.markSendUncertain).toHaveBeenCalledWith(intentId);
    expect(harness.recovery.rejectTerminal).not.toHaveBeenCalled();
    expect(harness.actions.onSendUncertain).toHaveBeenCalledOnce();
  });

  it("removes the terminal marker after a definitive rejection", async () => {
    const harness = setup();
    sendMessage.mockRejectedValueOnce(new ApiClientError(
      "Recipient rejected", 422, "MAIL_RECIPIENTS_REJECTED",
    ));
    await invoke(harness.submit);

    expect(harness.recovery.rejectTerminal).toHaveBeenCalledWith(intentId);
    expect(harness.recovery.markSendUncertain).not.toHaveBeenCalled();
  });
});
