import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { id } from "@/domain/shared/brand";
import type { ComposerRecoverySnapshot } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { plainTextToComposerHtml } from "@/presentation/features/mail-workspace/composer-body-content";
import type { useComposerAttachments } from "@/presentation/features/mail-workspace/hooks/use-composer-attachments";

const hooks = vi.hoisted(() => {
  const initialized = new Set<number>();
  const values: unknown[] = [];
  let cursor = 0;
  return {
    begin: () => { cursor = 0; },
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
    useState: <T,>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = typeof initial === "function"
          ? (initial as () => T)()
          : initial;
      }
      return [
        values[index] as T,
        (next: T | ((current: T) => T)) => {
          values[index] = typeof next === "function"
            ? (next as (current: T) => T)(values[index] as T)
            : next;
        },
      ] as const;
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T,>(callback: T): T => callback,
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T): T => factory(),
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

import { useComposerBody } from "@/presentation/features/mail-workspace/hooks/use-composer-body";
import { useComposerFields } from "@/presentation/features/mail-workspace/hooks/use-composer-fields";
import { useComposerRecoveryHydration } from "@/presentation/features/mail-workspace/hooks/use-composer-recovery-hydration";
import { useComposerSignatures } from "@/presentation/features/mail-workspace/hooks/use-composer-signatures";

const signatureId = id.signature("recovery-signature");
const signatureBook: EmailSignatureBook = {
  createdAt: "2026-08-01T08:00:00.000Z",
  defaults: { newMessageId: signatureId, replyForwardId: signatureId },
  revision: "signature-book-a",
  signatures: [{
    body: "Regards,\nAda",
    createdAt: "2026-08-01T08:00:00.000Z",
    id: signatureId,
    name: "Default",
    updatedAt: "2026-08-01T08:00:00.000Z",
    version: 1,
  }],
  updatedAt: "2026-08-01T08:00:00.000Z",
  version: 1,
};

const snapshot = (
  body: ComposerRecoverySnapshot["body"],
  overrides: Partial<ComposerRecoverySnapshot> = {},
): ComposerRecoverySnapshot => ({
  bcc: "",
  body,
  cc: "",
  hadLocalAttachments: false,
  signatureDisposition: "none",
  subject: "Recovered subject",
  title: "New message",
  to: "partial@",
  ...overrides,
});

const attachments = (count: number) => ({
  attachments: Array.from({ length: count }, () => ({})),
}) as unknown as ReturnType<typeof useComposerAttachments>;

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});

describe("composer recovery hydration", () => {
  it("restores raw partial recipient fields exactly without reporting edits", () => {
    const onChange = vi.fn();
    const onFlattened = vi.fn();
    const value = snapshot(
      { mode: "plain", text: "Recovered body" },
      {
        bcc: "   ",
        cc: "copy@example.com, second@",
        hadLocalAttachments: true,
        inReplyTo: id.message("reply-source"),
        subject: "Subject still [being typed",
        title: "Reply all",
        to: 'unfinished@, "Ada" <ada@example.com>',
      },
    );
    const render = () => {
      hooks.begin();
      const fields = useComposerFields(onChange);
      const body = useComposerBody(false, onFlattened, onChange);
      const signatures = useComposerSignatures(signatureBook);
      const hydration = useComposerRecoveryHydration(
        fields, body, signatures, attachments(1),
      );
      return { body, fields, hydration, signatures };
    };

    let composer = render();
    composer.hydration.restore(value);
    composer = render();

    expect(composer.fields).toMatchObject({
      bcc: "   ",
      cc: "copy@example.com, second@",
      inReplyTo: id.message("reply-source"),
      showBcc: false,
      showCc: true,
      subject: "Subject still [being typed",
      title: "Reply all",
      to: 'unfinished@, "Ada" <ada@example.com>',
    });
    expect(composer.hydration.snapshot).toEqual(value);
    expect(onChange).not.toHaveBeenCalled();
    expect(onFlattened).not.toHaveBeenCalled();
  });

  it("restores plain and rich bodies and remounts the editor each time", () => {
    const onChange = vi.fn();
    const render = () => {
      hooks.begin();
      const fields = useComposerFields(onChange);
      const body = useComposerBody(false, vi.fn(), onChange);
      const signatures = useComposerSignatures(null);
      return {
        body,
        hydration: useComposerRecoveryHydration(
          fields, body, signatures, attachments(0),
        ),
      };
    };

    let composer = render();
    expect(composer.body.editorVersion).toBe(0);
    composer.hydration.restore(snapshot({
      mode: "plain",
      text: "Line one\nLine two",
    }));
    composer = render();
    expect(composer.body).toMatchObject({
      editorVersion: 1,
      html: plainTextToComposerHtml("Line one\nLine two"),
      mode: "plain",
      payload: { body: "Line one\nLine two" },
      recoveryBody: { mode: "plain", text: "Line one\nLine two" },
      text: "Line one\nLine two",
    });

    const rich = {
      html: "<p>Recovered rich body</p>",
      mode: "rich" as const,
      preserveLoadedHtml: true,
      text: "Recovered rich body",
    };
    composer.hydration.restore(snapshot(rich));
    composer = render();
    expect(composer.body).toMatchObject({
      editorVersion: 2,
      html: rich.html,
      mode: "rich",
      payload: { body: rich.text, htmlBody: rich.html },
      recoveryBody: rich,
      text: rich.text,
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("restores rendered signature content as detached without reinsertion", () => {
    const onChange = vi.fn();
    const render = () => {
      hooks.begin();
      const fields = useComposerFields(onChange);
      const body = useComposerBody(false, vi.fn(), onChange);
      const signatures = useComposerSignatures(signatureBook);
      return {
        hydration: useComposerRecoveryHydration(
          fields, body, signatures, attachments(0),
        ),
        signatures,
      };
    };

    let composer = render();
    composer.signatures.prepare("new");
    composer = render();
    expect(composer.signatures.configuration?.selectedId).toBe(signatureId);
    expect(composer.hydration.snapshot.signatureDisposition).toBe("detached");

    composer.hydration.restore(snapshot(
      { html: "<p>Body and rendered signature</p>", mode: "rich",
        preserveLoadedHtml: true, text: "Body and rendered signature" },
      { signatureDisposition: "detached" },
    ));
    composer = render();
    expect(composer.signatures).toMatchObject({
      announcement: "",
      configuration: null,
      isDetached: true,
    });
    expect(composer.hydration.snapshot.signatureDisposition).toBe("detached");
    expect(onChange).not.toHaveBeenCalled();
  });
});
