import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

type Result = Readonly<Record<string, unknown>>;
type Patch = Partial<Record<"anchor" | "emails" | "thread", Result>>;

const email = (emailId: string, threadId = "thread") => ({
  from: [], hasAttachment: false, id: emailId, keywords: {},
  mailboxIds: { inbox: true }, preview: "", receivedAt: "2026-08-03T10:00:00Z",
  size: 1, subject: "Subject", threadId, to: [],
});

const baseline = () => ({
  anchor: {
    accountId: "account", list: [{ id: "anchor", threadId: "thread" }],
    notFound: [], state: "state",
  },
  emails: {
    accountId: "account", list: [email("anchor"), email("later")],
    notFound: [], state: "state",
  },
  thread: {
    accountId: "account", list: [{ emailIds: ["anchor", "later"], id: "thread" }],
    notFound: [], state: "state",
  },
});

const readerFor = (patch: Patch = {}) => {
  const values = baseline();
  const request = vi.fn(async () => ({ methodResponses: [], sessionState: "state" }));
  const client = {
    getSession: async () => ({
      accounts: { account: { isReadOnly: false, name: "Test" } },
      apiUrl: "https://mail.example.com/jmap", capabilities: {},
      downloadUrl: "https://mail.example.com/download",
      primaryAccounts: { [JMAP_MAIL]: "account" },
      uploadUrl: "https://mail.example.com/upload", username: "member@example.com",
    }),
    request,
    result: (_response: unknown, callId: string) => {
      const key = callId.replace("conversation-", "") as keyof typeof values;
      return { ...values[key], ...patch[key] };
    },
  } as unknown as StalwartJmapClient;
  return {
    reader: new StalwartMailReader(client, {
      authType: "basic", baseUrl: "https://mail.example.com",
      secret: "secret", username: "member@example.com",
    }),
    request,
  };
};

const query = {
  anchorMessageId: id.message("anchor"),
  limit: CONVERSATION_PAGE_SIZE,
} as const;

describe("Stalwart conversation result validation", () => {
  it.each([
    ["anchor account", { anchor: { accountId: "other" } }],
    ["anchor notFound", { anchor: { notFound: ["anchor"] } }],
    ["thread account", { thread: { accountId: "other" } }],
    ["thread identity", { thread: { list: [{ emailIds: ["anchor"], id: "other" }] } }],
    ["anchor membership", { thread: { list: [{ emailIds: ["other"], id: "thread" }] } }],
    ["email account", { emails: { accountId: "other" } }],
    ["email notFound", { emails: { notFound: ["later"] } }],
    ["missing email", { emails: { list: [email("anchor")] } }],
    ["duplicate email", { emails: { list: [email("anchor"), email("anchor")] } }],
    ["wrong thread", { emails: { list: [email("anchor"), email("later", "other")] } }],
  ] as const)("rejects contradictory %s results", async (_name, patch) => {
    await expect(readerFor(patch).reader.getConversation(query)).rejects.toThrow(
      "The conversation could not be loaded.",
    );
  });

  it("does not expose an upstream provider error", async () => {
    const { reader, request } = readerFor();
    request.mockRejectedValueOnce(new Error("secret upstream provider detail"));
    const failure = reader.getConversation(query);
    await expect(failure).rejects.toThrow("The conversation could not be loaded.");
    await expect(failure).rejects.not.toThrow("secret upstream provider detail");
  });
});
