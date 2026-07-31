import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import { id } from "@/domain/shared/brand";

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
const content: DraftContent = {
  bcc: [], body: "saved", cc: [], subject: "Subject", to: [],
};
const uncertain: DraftDetail = {
  composeId,
  content,
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: true,
  id: providerId,
  revision: "revision-a",
  updatedAt: "2026-07-31T10:00:00.000Z",
};

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});

describe("uncertain provider draft hook", () => {
  it("hydrates read-only content and only permits exact-revision discard", async () => {
    api.getDraft.mockResolvedValueOnce(uncertain);
    api.deleteDraft.mockResolvedValueOnce(undefined);
    const onDiscarded = vi.fn();
    const onHydrate = vi.fn();
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content, enabled: true,
        handleSessionFailure: () => false, hasLocalAttachments: false,
        onDiscarded, onHydrate, onSaved: vi.fn(),
      });
    };

    let draft = render();
    await expect(draft.load(providerId)).resolves.toBe(false);
    draft = render();

    expect(onHydrate).toHaveBeenCalledWith(uncertain);
    expect(draft.error).toContain("uncertain send outcome");
    expect(draft.error).toContain("Check Sent");
    expect(draft).toMatchObject({
      canDiscard: true, canEdit: false, canSave: false, canSend: false,
    });
    await expect(draft.save()).resolves.toBe(false);
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.updateDraft).not.toHaveBeenCalled();

    await expect(draft.discard()).resolves.toBe(true);
    expect(api.deleteDraft).toHaveBeenCalledWith(
      providerId, "revision-a", "account-a", expect.any(AbortSignal),
    );
    expect(onDiscarded).toHaveBeenCalledOnce();
  });

  it("never creates a replacement when the requested provider draft failed to load", async () => {
    api.getDraft.mockRejectedValueOnce(new Error("Provider unavailable"));
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content, enabled: true,
        handleSessionFailure: () => false, hasLocalAttachments: false,
        onDiscarded: vi.fn(), onHydrate: vi.fn(), onSaved: vi.fn(),
      });
    };

    let draft = render();
    await expect(draft.load(providerId)).resolves.toBe(false);
    draft = render();
    expect(draft.loadFailed).toBe(true);
    await expect(draft.save()).resolves.toBe(false);
    expect(api.createDraft).not.toHaveBeenCalled();
    expect(api.updateDraft).not.toHaveBeenCalled();
  });
});
