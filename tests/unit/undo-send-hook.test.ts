import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const values: unknown[] = []; let cursor = 0;
  return {
    begin: () => { cursor = 0; }, reset: () => { cursor = 0; values.length = 0; },
    useState: <T,>(initial: T | (() => T)): [T, (next: T) => void] => {
      const index = cursor++;
      if (values[index] === undefined) {
        values[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      }
      return [values[index] as T, (next) => { values[index] = next; }];
    },
  };
});
const api = vi.hoisted(() => ({ cancelScheduledMessage: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useEffect: vi.fn(), useState: hooks.useState,
}));
vi.mock("@/transport/client/api-client", () => ({ mailApi: api }));

import { id } from "@/domain/shared/brand";
import { useUndoSend } from "@/presentation/features/mail-workspace/hooks/use-undo-send";

const message = {
  attemptCount: 0, createdAt: "2026-08-02T00:00:00.000Z",
  id: id.scheduledMessage("11111111-1111-4111-8111-111111111111"),
  lastError: null, purpose: "undo" as const, recipientCount: 1,
  scheduledAt: new Date(Date.now() + 30_000).toISOString(),
  status: "pending" as const, subject: "Undo me",
  updatedAt: "2026-08-02T00:00:00.000Z",
};
const options = () => ({
  handleSessionFailure: vi.fn(() => false), onChanged: vi.fn(),
  openSavedDraft: vi.fn(), sessionScope: "scope-a",
});
const render = (value: ReturnType<typeof options>) => {
  hooks.begin(); return useUndoSend(value);
};

beforeEach(() => { hooks.reset(); vi.clearAllMocks(); api.cancelScheduledMessage.mockResolvedValue(undefined); });

describe("undo-send cancellation", () => {
  it("atomically cancels before reopening the exact provider draft", async () => {
    const value = options(); let undo = render(value);
    undo.queue(message, id.providerDraft("provider-draft")); undo = render(value);
    expect(undo.view.isVisible).toBe(true);
    undo.view.onUndo(); await Promise.resolve(); await Promise.resolve();
    expect(api.cancelScheduledMessage).toHaveBeenCalledWith(message.id, "scope-a");
    expect(value.openSavedDraft).toHaveBeenCalledWith(id.providerDraft("provider-draft"));
    expect(value.onChanged).toHaveBeenCalledOnce();
  });

  it("does not restore a draft when the worker already owns the lease", async () => {
    api.cancelScheduledMessage.mockRejectedValueOnce(new Error("Already sending"));
    const value = options(); let undo = render(value);
    undo.queue(message, id.providerDraft("provider-draft")); undo = render(value);
    undo.view.onUndo(); await Promise.resolve(); await Promise.resolve();
    expect(value.openSavedDraft).not.toHaveBeenCalled();
    expect(render(value).view.error).toBe("Already sending");
  });
});
