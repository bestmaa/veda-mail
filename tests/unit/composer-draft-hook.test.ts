import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";
import { ApiClientError } from "@/transport/client/api-request";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => { cursor = 0; initialized.clear(); values.length = 0; },
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T): readonly [T, (next: T) => void] => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = initial;
      }
      return [values[index] as T, (next) => { values[index] = next; }];
    },
  };
});

const api = vi.hoisted(() => ({
  createDraft: vi.fn(),
  deleteDraft: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useEffect: () => undefined,
  useLayoutEffect: () => undefined,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock("@/transport/client/api-client", () => ({ mailApi: api }));

import { useComposerDraft } from "@/presentation/features/mail-workspace/hooks/use-composer-draft";

const composeId = id.draft("compose-a");
const providerId = id.providerDraft("provider-a");
const content = (body: string): DraftContent => (
  { bcc: [], body, cc: [], subject: "Subject", to: [] });
const detail = (overrides: Partial<DraftDetail> = {}): DraftDetail => ({
  composeId,
  content: content("saved"),
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerId,
  revision: "revision-a",
  updatedAt: "2026-07-31T10:00:00.000Z",
  ...overrides,
});

beforeEach(() => { hooks.reset(); vi.clearAllMocks(); });
describe("composer draft hook", () => {
  it("immediately blocks resend and discard after an uncertain send", () => {
    const render = () => {
      hooks.begin();
      return useComposerDraft({ accountKey: "account-a", composeId,
        content: content("draft"), enabled: false,
        handleSessionFailure: () => false, hasLocalAttachments: false,
        onDiscarded: vi.fn(), onHydrate: vi.fn(), onSaved: vi.fn() });
    };
    let draft = render();
    draft.markSendUncertain();
    draft = render();
    const lockedGeneration = draft.contentGeneration;
    expect([draft.canDiscard, draft.canEdit, draft.canSend,
      draft.requiresRecovery, draft.terminalRecovery])
      .toEqual([false, false, false, true, "send"]);
    expect(draft.error).toContain("Check Sent");
    draft.markUnsaved(); draft.markProgrammaticChange();
    draft = render();
    expect(draft.contentGeneration).toBe(lockedGeneration);
  });
  it("adopts a create response without marking edits made during save as saved", async () => {
    const pending = Promise.withResolvers<DraftDetail>();
    api.createDraft.mockReturnValueOnce(pending.promise);
    const onSaved = vi.fn();
    const render = (body: string) => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: content(body),
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(),
        onHydrate: vi.fn(), onSaved,
      });
    };

    let draft = render("first");
    draft.markUnsaved();
    draft = render("first");
    const saving = draft.save();
    draft.markUnsaved();
    pending.resolve(detail());
    await expect(saving).resolves.toBe(true);
    draft = render("newer");

    expect(draft.phase).toBe("unsaved");
    expect(draft.canSave).toBe(true);
    expect(draft.canSend).toBe(false);
    expect(draft.providerDraft).toBeNull();
    expect(onSaved).toHaveBeenCalledOnce();

    api.updateDraft.mockResolvedValueOnce(detail({ revision: "revision-b" }));
    await expect(draft.save()).resolves.toBe(true);
    expect(api.updateDraft).toHaveBeenCalledWith(
      providerId,
      expect.objectContaining({ expectedRevision: "revision-a" }),
      "account-a",
      expect.any(AbortSignal),
    );
    draft = render("newer");
    expect(draft.providerDraft).toEqual({
      composeId, expectedRevision: "revision-b", id: providerId,
    });
  });
  it.each([
    { hasAttachments: true },
    { hasTruncatedContent: true },
  ])("hydrates safe presentation but keeps unsafe provider drafts read-only", async (unsafe) => {
    api.getDraft.mockResolvedValueOnce(detail(unsafe));
    const onHydrate = vi.fn();
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: content("local"),
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(), onHydrate,
        onSaved: vi.fn(),
      });
    };

    let draft = render();
    await expect(draft.load(providerId)).resolves.toBe(false);
    draft = render();
    await expect(draft.save()).resolves.toBe(false);

    expect(onHydrate).toHaveBeenCalledWith(expect.objectContaining(unsafe));
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.updateDraft).not.toHaveBeenCalled();
    expect(draft.canEdit).toBe(false);
    expect(draft.providerDraft).toBeNull();
  });
  it("requires recovery after a create response is lost", async () => {
    api.createDraft.mockRejectedValueOnce(new Error("Connection lost"));
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: content("draft"),
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(),
        onHydrate: vi.fn(), onSaved: vi.fn(),
      });
    };
    let draft = render();
    draft.markUnsaved();
    draft = render();
    await expect(draft.save()).resolves.toBe(false);
    draft = render();

    expect(draft.canSend).toBe(false);
    expect(draft.canDiscard).toBe(false);
    expect(draft.sendBlockedMessage).toContain("Recover");
    expect(draft.hasUnsavedChanges).toBe(true);

    api.createDraft.mockResolvedValueOnce(detail());
    await expect(draft.retry()).resolves.toBe(true);
    draft = render();
    expect(draft.canSend).toBe(true);
    expect(draft.canDiscard).toBe(true);
  });
  it("stops exact recovery after a definitive conflict and keeps later content", async () => {
    api.getDraft.mockResolvedValueOnce(detail());
    api.updateDraft
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockRejectedValueOnce(new ApiClientError(
        "This saved draft changed.", 409, "MAIL_DRAFT_CONFLICT",
      ));
    const render = (body: string) => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: content(body),
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(),
        onHydrate: vi.fn(), onSaved: vi.fn(),
      });
    };

    let draft = render("saved");
    await draft.load(providerId);
    draft = render("attempted");
    draft.markUnsaved();
    draft = render("attempted");
    await expect(draft.save()).resolves.toBe(false);
    draft = render("attempted");
    expect(draft.canDiscard).toBe(false);
    await expect(draft.discard()).resolves.toBe(false);
    expect(api.deleteDraft).not.toHaveBeenCalled();

    draft.markUnsaved();
    draft = render("newer");
    await expect(draft.retry()).resolves.toBe(false);
    draft = render("newer");
    expect(draft.error).toContain("local changes are still here");
    expect(draft.requiresRecovery).toBe(false);
    expect(draft.phase).toBe("conflict");
    expect(draft.canDiscard).toBe(true);
    expect(draft.canSave).toBe(true);
    expect(draft.providerDraft).toBeNull();
    expect(api.updateDraft).toHaveBeenCalledTimes(2);
  });

  it("deduplicates an in-flight revision-safe discard", async () => {
    api.getDraft.mockResolvedValueOnce(detail());
    const pending = Promise.withResolvers<void>();
    api.deleteDraft.mockReturnValueOnce(pending.promise);
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: content("saved"),
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(),
        onHydrate: vi.fn(), onSaved: vi.fn(),
      });
    };
    let draft = render();
    await draft.load(providerId);
    draft = render();
    const first = draft.discard();
    await expect(draft.discard()).resolves.toBe(false);
    expect(api.deleteDraft).toHaveBeenCalledOnce();
    pending.resolve();
    await expect(first).resolves.toBe(true);
  });
});
