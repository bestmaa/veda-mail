import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EmailSignature,
  EmailSignatureBook,
} from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import type { EmailSignaturesModel } from "@/presentation/features/mail-workspace/hooks/use-email-signatures-model";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => {
      cursor = 0;
    },
    reset: () => {
      cursor = 0;
      initialized.clear();
      values.length = 0;
    },
    useCallback: <T>(callback: T): T => {
      cursor += 1;
      return callback;
    },
    useEffect: () => {
      cursor += 1;
    },
    useRef: <T>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T>(initial: T) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = initial;
      }
      return [
        values[index] as T,
        (next: T | ((current: T) => T)) => {
          values[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(values[index] as T)
              : next;
        },
      ] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-email-signature-defaults-model",
  () => ({
    useEmailSignatureDefaultsModel: () => ({
      canDiscard: false,
      canSave: false,
      isDirty: false,
      newMessageId: "",
      newMessageInput: vi.fn(),
      onDiscard: vi.fn(),
      onSubmit: vi.fn(),
      replyForwardId: "",
      replyForwardInput: vi.fn(),
    }),
  }),
);

vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-email-signature-delete-model",
  () => ({
    useEmailSignatureDeleteModel: () => ({
      confirmation: {
        description: "",
        isOpen: false,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
        title: "",
      },
      request: vi.fn(),
      reset: vi.fn(),
    }),
  }),
);

import { useEmailSignatureSettingsModel } from "@/presentation/features/mail-workspace/hooks/use-email-signature-settings-model";

const signatureId = id.signature("11111111-1111-4111-8111-111111111111");
const signature = (htmlBody?: string): EmailSignature => ({
  body: "Ada",
  createdAt: "2026-07-31T00:00:00.000Z",
  ...(htmlBody ? { htmlBody } : {}),
  id: signatureId,
  name: "Work",
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: 1,
});
const signatures = (saved: EmailSignature): EmailSignaturesModel => {
  const book: EmailSignatureBook = {
    createdAt: saved.createdAt,
    defaults: { newMessageId: null, replyForwardId: null },
    revision: "revision-00000001",
    signatures: [saved],
    updatedAt: saved.updatedAt,
    version: 1,
  };
  return {
    book,
    clearError: vi.fn(),
    error: null,
    hasSessionChanged: false,
    isLoading: false,
    isSaving: false,
    mutate: vi.fn(),
    phase: "ready",
    retry: vi.fn(),
  };
};
const render = (model: EmailSignaturesModel) => {
  hooks.begin();
  return useEmailSignatureSettingsModel(
    "member@example.com",
    model,
    "scope-a",
  );
};
const selectSaved = (model: EmailSignaturesModel) => {
  render(model).items[0]?.onSelect();
  return render(model);
};

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("window", { requestAnimationFrame: vi.fn() });
});

describe("email signature rich initialization intent", () => {
  it("keeps Save enabled after a saved plain signature becomes rich", () => {
    const source = signatures(signature());
    let settings = selectSaved(source);
    expect(settings.editor?.canSave).toBe(false);

    settings.editor?.selectRichMode();
    settings = render(source);
    expect(settings.editor?.canSave).toBe(true);
    settings.editor?.onRichInitialize({
      html: "<p>Ada</p>",
      text: "Ada",
    });

    settings = render(source);
    expect(settings.editor?.canSave).toBe(true);
    expect(settings.editor?.canDiscard).toBe(true);
  });

  it("normalizes a selected rich baseline but not a later mode round trip", () => {
    const source = signatures(signature("<p><strong>Ada</strong></p>"));
    let settings = selectSaved(source);
    settings.editor?.onRichInitialize({
      html: "<p><b>Ada</b></p>",
      text: "Ada",
    });
    settings = render(source);
    expect(settings.editor?.canSave).toBe(false);

    settings.editor?.onRichChange({
      html: "<p><b>Ada</b>!</p>",
      text: "Ada!",
    });
    settings = render(source);
    expect(settings.editor?.canSave).toBe(true);
    settings.editor?.onDiscard();
    settings = render(source);
    settings.editor?.onRichInitialize({
      html: "<p><b>Ada</b></p>",
      text: "Ada",
    });
    settings = render(source);
    expect(settings.editor?.canSave).toBe(false);

    settings.editor?.selectPlainMode();
    settings = render(source);
    expect(settings.modeConfirmation.isOpen).toBe(true);
    settings.modeConfirmation.onConfirm();
    settings = render(source);
    expect(settings.editor?.canSave).toBe(true);

    settings.editor?.selectRichMode();
    settings = render(source);
    settings.editor?.onRichInitialize({
      html: "<p>Ada</p>",
      text: "Ada",
    });
    settings = render(source);
    expect(settings.editor?.canSave).toBe(true);
    expect(settings.editor?.canDiscard).toBe(true);
  });
});
