import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const values: unknown[] = []; let cursor = 0;
  return {
    begin: () => { cursor = 0; }, reset: () => { cursor = 0; values.length = 0; },
    useState: <T,>(initial: T): [T, (next: T) => void] => {
      const index = cursor++; if (values[index] === undefined) values[index] = initial;
      return [values[index] as T, (next) => { values[index] = next; }];
    },
  };
});
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback, useState: hooks.useState,
}));
vi.mock("@/presentation/shared/hooks/use-modal-dialog-focus", () => ({
  useModalDialogFocus: vi.fn(),
}));

import { useComposerSendConfirmation } from "@/presentation/features/mail-workspace/hooks/use-composer-send-confirmation";

const render = (enabled: boolean, submit: () => Promise<void>) => {
  hooks.begin(); return useComposerSendConfirmation(enabled, submit);
};

beforeEach(() => { hooks.reset(); vi.clearAllMocks(); });

describe("composer send confirmation", () => {
  it("waits for explicit confirmation when enabled", async () => {
    const submit = vi.fn(async () => undefined);
    let confirmation = render(true, submit);
    confirmation.onSubmit({ preventDefault: vi.fn() } as never);
    confirmation = render(true, submit);
    expect(confirmation.isOpen).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    confirmation.onConfirm();
    await Promise.resolve();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("submits immediately when disabled", async () => {
    const submit = vi.fn(async () => undefined);
    render(false, submit).onSubmit({ preventDefault: vi.fn() } as never);
    await Promise.resolve();
    expect(submit).toHaveBeenCalledOnce();
  });
});
