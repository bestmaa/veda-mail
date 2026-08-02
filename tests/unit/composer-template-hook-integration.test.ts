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
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      }
      return [values[index] as T, (next: T | ((current: T) => T)) => {
        values[index] = typeof next === "function"
          ? (next as (current: T) => T)(values[index] as T)
          : next;
      }] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCallback: <T,>(callback: T): T => callback,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerTemplates } from "@/presentation/features/mail-workspace/hooks/use-composer-templates";
import type { EmailTemplatesModel } from "@/presentation/features/mail-workspace/hooks/use-email-templates-model";

const templateId = id.template("11111111-1111-4111-8111-111111111111");
const book: EmailTemplateBook = {
  createdAt: "2026-08-02T00:00:00.000Z",
  revision: "22222222-2222-4222-8222-222222222222",
  templates: [{
    body: "Template body",
    createdAt: "2026-08-02T00:00:00.000Z",
    id: templateId,
    name: "Interview",
    subject: "Template subject",
    updatedAt: "2026-08-02T00:00:00.000Z",
    version: 1,
  }],
  updatedAt: "2026-08-02T00:00:00.000Z",
  version: 1,
};

const model = (
  mutate = vi.fn(),
  templateBook: EmailTemplateBook = book,
): EmailTemplatesModel => ({
  book: templateBook,
  clearError: vi.fn(),
  error: null,
  hasSessionChanged: false,
  isLoading: false,
  isSaving: false,
  mutate,
  phase: "ready",
  retry: vi.fn(),
});

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("window", {
    cancelAnimationFrame: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
  });
});

describe("composer template hook integration", () => {
  it("rejects an oversized Insert before changing the composer", () => {
    const oversizedBook: EmailTemplateBook = {
      ...book,
      templates: [{ ...book.templates[0]!, body: "y".repeat(10_000) }],
    };
    const templatesModel = model(vi.fn(), oversizedBook);
    const dirty = vi.fn();
    const render = () => {
      hooks.begin();
      const body = useComposerBody(false, vi.fn(), dirty);
      const fields = useComposerFields(dirty);
      return { body, templates: useComposerTemplates({
        body, disabled: false, fields, templates: templatesModel,
      }) };
    };
    let composer = render();
    composer.templates.onSelect({ target: { value: templateId } } as never);
    composer.body.loadSavedDraft({ body: "x".repeat(250_000) });
    composer = render();
    dirty.mockClear();
    composer.templates.onInsert();
    composer = render();
    expect(composer.templates.application).toBeNull();
    expect(composer.templates.error).toContain("message too large");
    expect(composer.body.text).toHaveLength(250_000);
    expect(dirty).not.toHaveBeenCalled();
  });

  it("keeps subject on Insert and changes only subject/body on confirmed Replace", () => {
    const dirty = vi.fn();
    const templatesModel = model();
    const render = () => {
      hooks.begin();
      const body = useComposerBody(false, vi.fn(), dirty);
      const fields = useComposerFields(dirty);
      return {
        body,
        fields,
        templates: useComposerTemplates({
          body, disabled: false, fields, templates: templatesModel,
        }),
      };
    };
    let composer = render();
    composer.templates.onSelect({ target: { value: templateId } } as never);
    composer.body.loadPlainDraft("Hello world");
    composer.fields.onSubjectInput({ target: { value: "Current subject" } } as never);
    composer = render();
    dirty.mockClear();

    composer.templates.onInsert();
    composer = render();
    expect(composer.templates.application?.action).toBe("insert");
    expect(composer.fields.subject).toBe("Current subject");
    composer.body.applyPlainTemplate(composer.templates.application!, 6, 6);
    composer = render();
    expect(composer.body.text).toBe("Hello Template bodyworld");
    expect(dirty).toHaveBeenCalledOnce();

    dirty.mockClear();
    composer.templates.onApplied(composer.templates.application!.nonce);
    composer.templates.onRequestReplace();
    composer = render();
    expect(composer.templates.dialog).toBe("replace");
    expect(composer.fields.subject).toBe("Current subject");
    composer.templates.confirmReplace();
    composer = render();
    expect(composer.fields.subject).toBe("Current subject");
    expect(composer.templates.isApplying).toBe(true);
    composer.body.applyPlainTemplate(composer.templates.application!, 0, 0);
    composer = render();
    expect(composer.body.text).toBe("Template body");
    expect(composer.fields.subject).toBe("Current subject");
    expect(composer.templates.isApplying).toBe(true);
    composer.templates.onApplied(composer.templates.application!.nonce);
    composer = render();
    expect(composer.fields.subject).toBe("Template subject");
    expect(composer.templates.isApplying).toBe(false);
    expect(dirty).toHaveBeenCalledOnce();
  });

  it("ignores a stale template acknowledgement after composer reset", () => {
    const dirty = vi.fn();
    const templatesModel = model();
    const render = () => {
      hooks.begin();
      const body = useComposerBody(false, vi.fn(), dirty);
      const fields = useComposerFields(dirty);
      return { fields, templates: useComposerTemplates({
        body, disabled: false, fields, templates: templatesModel,
      }) };
    };
    let composer = render();
    composer.templates.onSelect({ target: { value: templateId } } as never);
    composer.fields.onSubjectInput({ target: { value: "Keep me" } } as never);
    composer = render();
    composer.templates.confirmReplace();
    composer = render();
    const nonce = composer.templates.application!.nonce;
    composer.templates.reset();
    composer = render();
    composer.templates.onApplied(nonce);
    composer = render();
    expect(composer.fields.subject).toBe("Keep me");
    expect(composer.templates.isApplying).toBe(false);
  });

  it("saves the signature-free rich template snapshot", async () => {
    const mutate = vi.fn(async () => book);
    const templatesModel = model(mutate);
    const render = () => {
      hooks.begin();
      const body = useComposerBody(false);
      const fields = useComposerFields(vi.fn());
      return { body, templates: useComposerTemplates({
        body, disabled: false, fields, templates: templatesModel,
      }) };
    };
    let composer = render();
    composer.body.onRichChange({
      html: '<p>Hello</p><div data-veda-signature-id="work"><p>Regards</p></div>',
      templateHtml: "<p>Hello</p>",
      templateText: "Hello",
      text: "Hello\nRegards",
    });
    composer = render();
    composer.templates.onSaveNew();
    composer = render();
    composer.templates.nameInput({ target: { value: "Greeting" } } as never);
    composer = render();
    await composer.templates.confirmSave();
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      content: {
        htmlBody: "<p>Hello</p>",
        mode: "rich",
        subject: "",
      },
      name: "Greeting",
      operation: "create",
    }));
  });
});
