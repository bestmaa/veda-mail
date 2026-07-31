import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import type { ComposerRecoveryJournalPort } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-journal";
import type { useComposerDraftRequest } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-request";
import { ApiClientError } from "@/transport/client/api-request";
import { recoverySnapshot } from "./composer-recovery-fixture";

const deleteDraft = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useRef: <T,>(initial: T) => ({ current: initial }),
}));
vi.mock("@/transport/client/api-client", () => ({
  mailApi: { deleteDraft },
}));

import { useComposerDraftDiscard } from "@/presentation/features/mail-workspace/hooks/use-composer-draft-discard";

const composeId = id.draft("compose-discard-a");
const providerDraftId = id.providerDraft("provider-discard-a");
const intentId = "66666666-6666-4666-8666-666666666666";
const saved: DraftDetail = {
  composeId,
  content: { bcc: [], body: "Body", cc: [], subject: "Subject", to: [] },
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerDraftId,
  revision: "revision-a",
  updatedAt: "2026-07-31T12:00:00.000Z",
};

const setup = () => {
  const operation = {
    accountKey: "scope-a", controller: new AbortController(), generation: 1,
  };
  const request = {
    begin: vi.fn(() => operation), finish: vi.fn(() => true),
    invalidate: vi.fn(), isCurrent: vi.fn(() => true),
  } as unknown as ReturnType<typeof useComposerDraftRequest>;
  const prepareDiscard = vi.fn().mockResolvedValue({
    expectedRevision: saved.revision, intentId, providerDraftId,
  });
  const recovery = {
    clearActive: vi.fn().mockResolvedValue(undefined),
    completeTerminal: vi.fn().mockResolvedValue(true),
    prepareDiscard,
    rejectTerminal: vi.fn().mockResolvedValue(true),
  } as unknown as ComposerRecoveryJournalPort;
  const actions = {
    onDiscarded: vi.fn(), reset: vi.fn(), setError: vi.fn(),
    setIsDiscarding: vi.fn(), setPhase: vi.fn(),
  };
  const discard = useComposerDraftDiscard({
    accountKey: "scope-a", composeId, contentGeneration: 2,
    handleSessionFailure: () => false, onDiscarded: actions.onDiscarded,
    recovery, recoverySnapshot: recoverySnapshot(), request, requested: true,
    requiresRecovery: false, reset: actions.reset, saved,
    setError: actions.setError,
    setIsDiscarding: actions.setIsDiscarding,
    setPhase: actions.setPhase,
  });
  return { actions, discard, prepareDiscard, recovery };
};

beforeEach(() => deleteDraft.mockReset());

describe("composer terminal discard recovery", () => {
  it("journals the exact reference before DELETE and clears it after success", async () => {
    const harness = setup();
    deleteDraft.mockImplementationOnce(async () => {
      expect(harness.prepareDiscard).toHaveBeenCalledOnce();
    });
    await expect(harness.discard()).resolves.toBe(true);

    expect(deleteDraft).toHaveBeenCalledWith(
      providerDraftId, "revision-a", "scope-a", expect.any(AbortSignal),
    );
    expect(harness.recovery.completeTerminal).toHaveBeenCalledWith(intentId);
    expect(harness.actions.onDiscarded).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous marker but rejects a definitive conflict marker", async () => {
    const ambiguous = setup();
    deleteDraft.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(ambiguous.discard()).resolves.toBe(false);
    expect(ambiguous.recovery.rejectTerminal).not.toHaveBeenCalled();

    const timedOut = setup();
    deleteDraft.mockRejectedValueOnce(new ApiClientError(
      "Timed out", 408, "REQUEST_TIMEOUT",
    ));
    await expect(timedOut.discard()).resolves.toBe(false);
    expect(timedOut.recovery.rejectTerminal).not.toHaveBeenCalled();

    const conflict = setup();
    deleteDraft.mockRejectedValueOnce(new ApiClientError(
      "Draft changed", 409, "MAIL_DRAFT_CONFLICT",
    ));
    await expect(conflict.discard()).resolves.toBe(false);
    expect(conflict.recovery.rejectTerminal).toHaveBeenCalledWith(intentId);
  });

  it("treats an already absent exact draft as completed", async () => {
    const harness = setup();
    deleteDraft.mockRejectedValueOnce(new ApiClientError(
      "Not found", 404, "MAIL_DRAFT_NOT_FOUND",
    ));
    await expect(harness.discard()).resolves.toBe(true);
    expect(harness.recovery.completeTerminal).toHaveBeenCalledWith(intentId);
  });
});
