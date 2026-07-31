import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";
import type { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(value: T) => [value, vi.fn()] as const,
}));

import { useComposerClose } from "@/presentation/features/mail-workspace/hooks/use-composer-close";

const setup = ({
  clearRecovery = vi.fn(async () => undefined),
  hasUnsavedChanges = false,
}: {
  readonly clearRecovery?: () => Promise<void>;
  readonly hasUnsavedChanges?: boolean;
} = {}) => {
  const events: string[] = [];
  const attachments = {
    attachments: [{ source: {}, state: "uploading" }],
    discard: vi.fn(() => { events.push("attachments"); }),
  } as unknown as ReturnType<typeof useComposerAttachments>;
  const draft = {
    canDiscard: true,
    clearRecovery: vi.fn(async () => {
      events.push("clear-start");
      await clearRecovery();
      events.push("clear-end");
    }),
    discard: vi.fn().mockResolvedValue(true),
    hasUnsavedChanges,
    isDiscarding: false,
    isLoading: false,
    phase: "unsaved",
    requiresDiscardConfirmation: false,
    reset: vi.fn(() => { events.push("reset"); }),
  } as unknown as ReturnType<typeof useComposerDraft>;
  const actions = {
    setConfirmClose: vi.fn(), setConfirmDiscard: vi.fn(), setError: vi.fn(),
    setIsOpen: vi.fn((value: SetStateAction<boolean>) => {
      const open = typeof value === "function" ? value(true) : value;
      events.push(`open:${open}`);
    }),
  };
  const close = useComposerClose({
    accountKeyRef: { current: "account-a" }, attachments,
    confirmClose: false, confirmDiscard: false, draft, isSending: false,
    openAccountKey: "account-a", resetEditor: vi.fn(() => events.push("editor")),
    returnFocus: { remember: vi.fn(), restore: vi.fn(() => events.push("focus")) },
    ...actions,
  });
  return { actions, attachments, close, draft, events };
};

describe("composer close lifecycle", () => {
  it("confirms before abandoning an uploading attachment and message", () => {
    const harness = setup({ hasUnsavedChanges: true });
    harness.close.requestClose();

    expect(harness.actions.setConfirmClose).toHaveBeenCalledWith(true);
    expect(harness.draft.clearRecovery).not.toHaveBeenCalled();
    expect(harness.attachments.discard).not.toHaveBeenCalled();
  });

  it("removes ordinary recovery before closing a clean composer", async () => {
    const pending = Promise.withResolvers<void>();
    const harness = setup({ clearRecovery: vi.fn(() => pending.promise) });
    const closing = harness.close.confirmClose();
    expect(harness.events).toEqual(["clear-start"]);

    pending.resolve();
    await closing;
    expect(harness.events).toEqual([
      "clear-start", "clear-end", "open:false", "reset", "editor",
      "attachments", "focus",
    ]);
  });

  it("keeps the composer visible when secure recovery removal fails", async () => {
    const harness = setup({
      clearRecovery: vi.fn().mockRejectedValue(new Error("unavailable")),
    });
    await harness.close.confirmClose();

    expect(harness.actions.setIsOpen).not.toHaveBeenCalled();
    expect(harness.attachments.discard).not.toHaveBeenCalled();
    expect(harness.actions.setError).toHaveBeenLastCalledWith(
      expect.stringContaining("securely remove"),
    );
  });
});
