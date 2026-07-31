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

const composeId = id.draft("compose-authoritative");
const providerId = id.providerDraft("provider-authoritative");
const content = (body: string): DraftContent => ({
  bcc: [], body, cc: [], subject: "Subject", to: [],
});
const detail = (body: string, revision = "revision-a"): DraftDetail => ({
  composeId,
  content: content(body),
  hasAttachments: false,
  hasTruncatedContent: false,
  hasUncertainSubmission: false,
  id: providerId,
  revision,
  updatedAt: "2026-07-31T10:00:00.000Z",
});

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});

describe("composer authoritative draft save response", () => {
  it("hydrates server-canonical content when no newer edit occurred", async () => {
    api.createDraft.mockResolvedValueOnce(detail("server canonical"));
    let composerContent = content("client snapshot");
    const onHydrate = vi.fn((draft: DraftDetail) => {
      composerContent = draft.content;
    });
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: composerContent,
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(), onHydrate,
        onSaved: vi.fn(),
      });
    };

    let draft = render();
    draft.markUnsaved();
    draft = render();
    await expect(draft.save()).resolves.toBe(true);
    draft = render();

    expect(onHydrate).toHaveBeenCalledOnce();
    expect(composerContent).toEqual(content("server canonical"));
    expect(draft.phase).toBe("saved");
    expect(draft.canSend).toBe(true);
  });

  it("preserves a newer local edit and leaves it dirty", async () => {
    const pending = Promise.withResolvers<DraftDetail>();
    api.createDraft.mockReturnValueOnce(pending.promise);
    let composerContent = content("submitted snapshot");
    const onHydrate = vi.fn();
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: composerContent,
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(), onHydrate,
        onSaved: vi.fn(),
      });
    };

    let draft = render();
    draft.markUnsaved();
    draft = render();
    const saving = draft.save();
    composerContent = content("newer local edit");
    draft.markUnsaved();
    pending.resolve(detail("server canonical"));
    await expect(saving).resolves.toBe(true);
    draft = render();

    expect(onHydrate).not.toHaveBeenCalled();
    expect(composerContent).toEqual(content("newer local edit"));
    expect(draft.phase).toBe("unsaved");
    expect(draft.hasUnsavedChanges).toBe(true);
    expect(draft.canSend).toBe(false);
  });

  it("uses the adopted server content for the next save and send handle", async () => {
    api.createDraft.mockResolvedValueOnce(detail("server canonical"));
    api.updateDraft.mockResolvedValueOnce(detail("canonical plus edit", "revision-b"));
    let composerContent = content("client snapshot");
    const onHydrate = (draft: DraftDetail) => { composerContent = draft.content; };
    const render = () => {
      hooks.begin();
      return useComposerDraft({
        accountKey: "account-a", composeId, content: composerContent,
        enabled: true, handleSessionFailure: () => false,
        hasLocalAttachments: false, onDiscarded: vi.fn(), onHydrate,
        onSaved: vi.fn(),
      });
    };

    let draft = render();
    draft.markUnsaved();
    draft = render();
    await draft.save();
    draft = render();
    expect(composerContent).toEqual(content("server canonical"));
    expect(draft.providerDraft).toEqual({
      composeId, expectedRevision: "revision-a", id: providerId,
    });

    composerContent = content("canonical plus edit");
    draft.markUnsaved();
    draft = render();
    await expect(draft.save()).resolves.toBe(true);
    expect(api.updateDraft).toHaveBeenCalledWith(providerId, {
      composeId,
      content: content("canonical plus edit"),
      expectedRevision: "revision-a",
    }, "account-a", expect.any(AbortSignal));
    draft = render();
    expect(draft.providerDraft?.expectedRevision).toBe("revision-b");
  });
});
