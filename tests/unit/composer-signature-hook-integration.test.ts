import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";

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
    useRef: <T,>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T,>(
      initial: T | (() => T),
    ): readonly [
      T,
      (next: T | ((current: T) => T)) => void,
    ] => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] =
          typeof initial === "function"
            ? (initial as () => T)()
            : initial;
      }
      return [
        values[index] as T,
        (next) => {
          values[index] =
            typeof next === "function"
              ? (next as (current: T) => T)(values[index] as T)
              : next;
        },
      ];
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
import { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";

const signatureBook = (
  signatureId: string,
  revision: string,
): EmailSignatureBook => {
  const selectedId = id.signature(signatureId);
  return {
    createdAt: "2026-07-31T10:00:00.000Z",
    defaults: {
      newMessageId: selectedId,
      replyForwardId: selectedId,
    },
    revision,
    signatures: [
      {
        body: `Regards,\n${signatureId}`,
        createdAt: "2026-07-31T10:00:00.000Z",
        htmlBody: `<p><strong>Regards,</strong><br>${signatureId}</p>`,
        id: selectedId,
        name: signatureId,
        updatedAt: "2026-07-31T10:00:00.000Z",
        version: 1,
      },
    ],
    updatedAt: "2026-07-31T10:00:00.000Z",
    version: 1,
  };
};

beforeEach(() => {
  hooks.reset();
  vi.stubGlobal("document", { getElementById: () => null });
  vi.stubGlobal("window", {
    cancelAnimationFrame: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
  });
});

describe("composer signature hook integration", () => {
  it("detaches exactly once and keeps the picker unavailable after remount", () => {
    const book = signatureBook("Work", "revision-a");
    let flattened = 0;
    const render = () => {
      hooks.begin();
      const signatures = useComposerSignatures(book);
      const body = useComposerBody(false, () => {
        flattened += 1;
        signatures.detach();
      });
      return { body, signatures };
    };

    let model = render();
    model.signatures.prepare("new");
    model = render();
    expect(model.signatures.configuration?.selectedId).toBe("Work");
    expect(model.signatures.configuration?.initialContentPlacement).toBe(
      "prefix",
    );

    model.body.onRichChange({
      html:
        '<p>Hello</p><div data-veda-signature-id="Work">' +
        "<p><strong>Regards,</strong><br>Work</p></div>",
      text: "Hello\n\nRegards,\nWork",
    });
    model = render();
    model.body.onToggleMode();
    model = render();
    expect(flattened).toBe(0);
    expect(model.body.isPlainModeWarningOpen).toBe(true);

    model.body.confirmPlainMode();
    model = render();
    expect(flattened).toBe(1);
    expect(model.body.mode).toBe("plain");
    expect(model.signatures.configuration).toBeNull();
    expect(model.signatures.isDetached).toBe(true);
    expect(model.signatures.announcement).toContain("editable plain text");

    model.body.onToggleMode();
    model = render();
    expect(flattened).toBe(1);
    expect(model.body.mode).toBe("rich");
    expect(model.signatures.configuration).toBeNull();
    expect(model.body.text.match(/Regards,/gu)).toHaveLength(1);

    model.body.reset();
    model.signatures.reset();
    model.signatures.prepare("new");
    model = render();
    expect(model.signatures.configuration?.selectedId).toBe("Work");
    expect(model.signatures.isDetached).toBe(false);
  });

  it("snapshots an open compose but uses fresh defaults on the next one", () => {
    let book = signatureBook("First", "revision-a");
    const render = () => {
      hooks.begin();
      return useComposerSignatures(book);
    };

    let signatures = render();
    signatures.prepare("new");
    signatures = render();
    expect(signatures.configuration?.selectedId).toBe("First");

    book = signatureBook("Latest", "revision-b");
    signatures = render();
    expect(signatures.configuration?.selectedId).toBe("First");
    expect(signatures.configuration?.options[0]?.name).toBe("First");

    signatures.reset();
    signatures.prepare("new");
    signatures = render();
    expect(signatures.configuration?.selectedId).toBe("Latest");
    expect(signatures.configuration?.options[0]?.name).toBe("Latest");
  });

  it("does not insert a late-loading default into an active draft", () => {
    let book: EmailSignatureBook | null = null;
    const render = () => {
      hooks.begin();
      return useComposerSignatures(book);
    };

    let signatures = render();
    signatures.prepare("new");
    signatures = render();
    expect(signatures.configuration).toBeNull();

    book = signatureBook("Loaded", "revision-a");
    signatures = render();
    expect(signatures.configuration).toBeNull();

    signatures.reset();
    signatures.prepare("new");
    signatures = render();
    expect(signatures.configuration?.selectedId).toBe("Loaded");
  });

  it("seeds the reply default before its quoted tail", () => {
    const book = signatureBook("Reply", "revision-a");
    hooks.begin();
    let signatures = useComposerSignatures(book);
    signatures.prepare("reply-forward");
    hooks.begin();
    signatures = useComposerSignatures(book);

    expect(signatures.configuration?.selectedId).toBe("Reply");
    expect(signatures.configuration?.initialContentPlacement).toBe("tail");
  });
});
