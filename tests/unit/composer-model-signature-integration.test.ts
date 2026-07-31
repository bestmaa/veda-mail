import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailSignatureBook } from "@/domain/member/email-signature";
import type { MessageDetail } from "@/domain/mail/mail";
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

const dependencies = vi.hoisted(() => ({
  attachments: {
    attachmentIds: [],
    attachments: [],
    capabilityUnavailable: false,
    discard: vi.fn(() => "draft"),
    draftId: "draft",
    expireReady: vi.fn(() => false),
    hasError: false,
    importOriginalAttachments: vi.fn(),
    invalidateReady: vi.fn(),
    isUploading: false,
    maxFileBytes: 1_000,
    onFiles: vi.fn(),
    refreshCapability: vi.fn(),
    remove: vi.fn(),
    retry: vi.fn(),
  },
  remember: vi.fn(),
  restore: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useCallback: <T,>(callback: T): T => callback,
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useMemo: <T,>(factory: () => T): T => factory(),
    useRef: hooks.useRef,
    useState: hooks.useState,
  };
});

vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-composer-attachments",
  () => ({
    useComposerAttachments: () => dependencies.attachments,
  }),
);
vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-composer-focus",
  () => ({
    useComposerFocusTrap: () => undefined,
    useComposerReturnFocus: () => ({
      remember: dependencies.remember,
      restore: dependencies.restore,
    }),
  }),
);
vi.mock(
  "@/presentation/features/mail-workspace/hooks/use-composer-submit",
  () => ({
    useComposerSubmit: () => vi.fn(),
  }),
);

import { useComposerModel } from "@/presentation/features/mail-workspace/hooks/use-composer-model";
import { createComposerViewModel } from "@/presentation/features/mail-workspace/composer.view-model";

const selectedId = id.signature("default-signature");
const book: EmailSignatureBook = {
  createdAt: "2026-07-31T10:00:00.000Z",
  defaults: {
    newMessageId: selectedId,
    replyForwardId: selectedId,
  },
  revision: "revision-a",
  signatures: [
    {
      body: "Regards,\nAda",
      createdAt: "2026-07-31T10:00:00.000Z",
      id: selectedId,
      name: "Default",
      updatedAt: "2026-07-31T10:00:00.000Z",
      version: 1,
    },
  ],
  updatedAt: "2026-07-31T10:00:00.000Z",
  version: 1,
};

const message: MessageDetail = {
  attachments: [],
  cc: [],
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  htmlBody: null,
  id: id.message("message-1"),
  isStarred: false,
  isUnread: true,
  mailboxIds: [id.mailbox("inbox")],
  preview: "Hello",
  receivedAt: "2026-07-31T09:00:00.000Z",
  replyTo: [],
  size: 100,
  subject: "Hello",
  textBody: "Quoted body",
  threadId: id.thread("thread-1"),
  to: [{ email: "me@example.com", name: "Me" }],
};

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
});

describe("composer model signature integration", () => {
  it("seeds, clears, and reseeds signatures for new and reply contexts", () => {
    const render = () => {
      hooks.begin();
      return useComposerModel(vi.fn(), 1_000, book, "account-a");
    };

    let composer = render();
    expect(composer.signatures.configuration).toBeNull();

    composer.open();
    composer = render();
    expect(composer.isOpen).toBe(true);
    expect(composer.signatures.configuration?.selectedId).toBe(selectedId);
    expect(
      composer.signatures.configuration?.initialContentPlacement,
    ).toBe("prefix");
    const newView = createComposerViewModel(composer);
    expect(newView.body.signature).toBe(
      composer.signatures.configuration,
    );
    expect(newView.body.signatureAnnouncement).toBe(
      composer.signatures.announcement,
    );

    composer.close();
    composer = render();
    expect(composer.isOpen).toBe(false);
    expect(composer.signatures.configuration).toBeNull();

    composer.openReply(message);
    composer = render();
    expect(composer.title).toBe("Reply");
    expect(composer.body.text).toContain("Quoted body");
    expect(composer.signatures.configuration?.selectedId).toBe(selectedId);
    expect(
      composer.signatures.configuration?.initialContentPlacement,
    ).toBe("tail");
    expect(createComposerViewModel(composer).body.signature).toBe(
      composer.signatures.configuration,
    );
  });

  it("hides an open draft immediately when its account scope changes", () => {
    let accountKey = "account-a";
    const render = () => {
      hooks.begin();
      return useComposerModel(vi.fn(), 1_000, book, accountKey);
    };

    let composer = render();
    composer.open();
    composer = render();
    expect(composer.isOpen).toBe(true);

    accountKey = "account-b";
    composer = render();
    expect(composer.isOpen).toBe(false);
  });
});
