import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateBook } from "@/domain/member/email-template";
import { id } from "@/domain/shared/brand";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
    reset: () => { cursor = 0; initialized.clear(); values.length = 0; },
    useRef: <T,>(initial: T) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = initial;
      }
      return [values[index] as T, (next: T | ((current: T) => T)) => {
        values[index] = typeof next === "function"
          ? (next as (current: T) => T)(values[index] as T)
          : next;
      }] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useCallback: <T,>(callback: T): T => callback,
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T): T => factory(),
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

import type { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import type { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerTemplates } from "@/presentation/features/mail-workspace/hooks/use-composer-templates";
import type { EmailTemplatesModel } from "@/presentation/features/mail-workspace/hooks/use-email-templates-model";

const existingId = id.template("11111111-1111-4111-8111-111111111111");
const createdId = id.template("33333333-3333-4333-8333-333333333333");
const template = {
  body: "Existing body",
  createdAt: "2026-08-02T00:00:00.000Z",
  id: existingId,
  name: "Resume",
  subject: "Existing subject",
  updatedAt: "2026-08-02T00:00:00.000Z",
  version: 1 as const,
};
const book: EmailTemplateBook = {
  createdAt: template.createdAt,
  revision: "22222222-2222-4222-8222-222222222222",
  templates: [template],
  updatedAt: template.updatedAt,
  version: 1,
};

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("window", {
    cancelAnimationFrame: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
  });
});

describe("composer template stable selection", () => {
  it("selects the response's new ID when accent-distinct names coexist", async () => {
    const nextBook: EmailTemplateBook = {
      ...book,
      templates: [template, { ...template, id: createdId, name: "Résumé" }],
    };
    const templates = {
      book,
      clearError: vi.fn(),
      error: null,
      hasSessionChanged: false,
      isLoading: false,
      isSaving: false,
      mutate: vi.fn(async () => nextBook),
      phase: "ready",
      retry: vi.fn(),
    } satisfies EmailTemplatesModel;
    const body = {
      mode: "plain",
      text: "Candidate profile",
    } as ReturnType<typeof useComposerBody>;
    const fields = {
      applyTemplateSubject: vi.fn(),
      subject: "Candidate",
    } as unknown as ReturnType<typeof useComposerFields>;
    const render = () => {
      hooks.begin();
      return useComposerTemplates({ body, disabled: false, fields, templates });
    };
    let composer = render();
    composer.onSaveNew();
    composer = render();
    composer.nameInput({ target: { value: "Résumé" } } as never);
    composer = render();
    await composer.confirmSave();
    composer = render();
    expect(composer.selectedId).toBe(createdId);
  });
});
