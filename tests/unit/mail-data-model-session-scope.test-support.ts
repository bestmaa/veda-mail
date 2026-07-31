import { vi } from "vitest";

import type { MailWorkspace, MessageDetail } from "@/domain/mail/mail";
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
    useRef: <T>(initial: T): { current: T } => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] = { current: initial };
      }
      return values[index] as { current: T };
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = cursor++;
      if (!initialized.has(index)) {
        initialized.add(index);
        values[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
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

const apiState = vi.hoisted(() => ({
  ApiClientError: class extends Error {
    public constructor(
      message: string,
      public readonly status: number,
      public readonly code = "UNKNOWN_ERROR",
    ) {
      super(message);
    }
  },
  getMessage: vi.fn(),
  getWorkspace: vi.fn(),
  mutateMessage: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCallback: <T>(callback: T): T => callback,
  useEffect: () => undefined,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

vi.mock("@/transport/client/api-client", () => ({
  ApiClientError: apiState.ApiClientError,
  mailApi: {
    getMessage: apiState.getMessage,
    getWorkspace: apiState.getWorkspace,
    mutateMessage: apiState.mutateMessage,
  },
}));

vi.mock("@/transport/client/api-request", () => ({
  ApiClientError: apiState.ApiClientError,
}));

import { useMailDataModel } from "@/presentation/features/mail-workspace/hooks/use-mail-data-model";

export const api = apiState;
export const ApiClientError = apiState.ApiClientError;
export const inboxId = id.mailbox("inbox");
export const workspace = (sessionScope: string): MailWorkspace => ({
  account: {
    email: "member@example.com",
    id: id.account("member"),
    name: "Member",
    providerId: id.provider("mock"),
  },
  mailboxes: [
    {
      color: "#4338ca",
      id: inboxId,
      name: "Inbox",
      role: "inbox",
      total: 1,
      unread: 0,
    },
  ],
  messages: { items: [], nextCursor: null, total: 0 },
  sessionScope,
});

export const message = (value = "message-a"): MessageDetail => ({
  attachments: [],
  cc: [],
  from: [{ email: "sender@example.com", name: "Sender" }],
  hasAttachment: false,
  htmlBody: null,
  id: id.message(value),
  isStarred: false,
  isUnread: false,
  mailboxIds: [inboxId],
  preview: "Private account A message",
  receivedAt: "2026-07-31T10:00:00.000Z",
  replyTo: [],
  size: 100,
  subject: "Account A",
  textBody: "Private account A body",
  threadId: id.thread("thread-a"),
  to: [{ email: "account-a@example.com", name: null }],
});

export const render = () => {
  hooks.begin();
  return useMailDataModel();
};

export const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

export const refresh = async (model: ReturnType<typeof render>) => {
  model.refresh();
  await settle();
};

export const resetMailDataModelHarness = () => {
  hooks.reset();
  api.getMessage.mockReset();
  api.getWorkspace.mockReset();
  api.mutateMessage.mockReset();
};
