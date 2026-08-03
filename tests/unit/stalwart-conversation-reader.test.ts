import { describe, expect, it, vi } from "vitest";

import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  type JmapEmail,
  type JmapMethodCall,
  type JmapSession,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const session: JmapSession = {
  accounts: { account: { isReadOnly: false, name: "Test" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: {},
  downloadUrl: "https://mail.example.com/download",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "member@example.com",
};

const email = (
  emailId: string,
  receivedAt: string,
  threadId = "thread",
): JmapEmail => ({
  from: [{ email: "sender@example.com" }],
  hasAttachment: false,
  id: emailId,
  keywords: {},
  mailboxIds: { inbox: true },
  preview: `Preview ${emailId}`,
  receivedAt,
  size: 100,
  subject: `Subject ${emailId}`,
  threadId,
  to: [{ email: "member@example.com" }],
});

interface ConversationResults {
  readonly anchor: Readonly<Record<string, unknown>>;
  readonly emails: Readonly<Record<string, unknown>>;
  readonly thread: Readonly<Record<string, unknown>>;
}

const resultSet = (
  messageIds: readonly string[] = ["anchor", "later", "earlier"],
): ConversationResults => ({
  anchor: {
    accountId: "account",
    list: [{ id: "anchor", threadId: "thread" }],
    notFound: [],
    state: "email-state",
  },
  emails: {
    accountId: "account",
    list: messageIds.map((messageId, index) =>
      email(
        messageId,
        new Date(Date.UTC(2026, 7, 3, 10, index)).toISOString(),
      ),
    ),
    notFound: [],
    state: "email-state",
  },
  thread: {
    accountId: "account",
    list: [{ emailIds: messageIds, id: "thread" }],
    notFound: [],
    state: "thread-state",
  },
});

const readerFor = (results: ConversationResults) => {
  const requests: JmapMethodCall[][] = [];
  const request = vi.fn(async (calls: readonly JmapMethodCall[]) => {
    requests.push([...calls]);
    return { methodResponses: [], sessionState: "state" };
  });
  const client = {
    getSession: async () => session,
    request,
    result: (
      _response: unknown,
      callId: string,
    ): Readonly<Record<string, unknown>> => {
      if (callId === "conversation-anchor") return results.anchor;
      if (callId === "conversation-thread") return results.thread;
      if (callId === "conversation-emails") return results.emails;
      throw new Error("unexpected test call");
    },
  } as unknown as StalwartJmapClient;
  return {
    reader: new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "member@example.com",
    }),
    request,
    requests,
  };
};

describe("Stalwart native conversations", () => {
  it("resolves the anchor and exact thread before returning deduplicated chronological messages", async () => {
    const results = resultSet(["later", "anchor", "earlier"]);
    const { reader, requests } = readerFor({
      ...results,
      emails: {
        ...results.emails,
        list: [
          email("anchor", "2026-08-03T10:01:00.000Z"),
          email("later", "2026-08-03T10:02:00.000Z"),
          email("earlier", "2026-08-03T10:00:00.000Z"),
        ],
      },
      thread: {
        ...results.thread,
        list: [
          {
            emailIds: ["later", "anchor", "anchor", "earlier"],
            id: "thread",
          },
        ],
      },
    });

    await expect(
      reader.getConversation({
        anchorMessageId: id.message("anchor"),
        limit: CONVERSATION_PAGE_SIZE,
      }),
    ).resolves.toMatchObject({
      anchorMessageId: "anchor",
      items: [
        { id: "earlier" },
        { id: "anchor" },
        { id: "later" },
      ],
      nextCursor: null,
      strategy: "native",
      total: 3,
      truncated: false,
    });
    expect(requests).toHaveLength(3);
    expect(requests[0]?.[0]).toEqual([
      "Email/get",
      {
        accountId: "account",
        ids: ["anchor"],
        properties: ["id", "threadId"],
      },
      "conversation-anchor",
    ]);
    expect(requests[1]?.[0]).toEqual([
      "Thread/get",
      {
        accountId: "account",
        ids: ["thread"],
        properties: ["id", "emailIds"],
      },
      "conversation-thread",
    ]);
    expect(requests[2]?.[0]?.[1]).toMatchObject({
      accountId: "account",
      ids: ["later", "anchor", "earlier"],
    });
  });

  it("uses a snapshot-bound 25-message cursor, caps at 100, and retains the anchor", async () => {
    const membership = Array.from({ length: 101 }, (_, index) => `m-${index}`);
    const bounded = [...membership.slice(0, 99), "m-100"];
    const results = resultSet(bounded);
    const { reader, requests } = readerFor({
      ...results,
      anchor: {
        ...results.anchor,
        list: [{ id: "m-100", threadId: "thread" }],
      },
      thread: {
        ...results.thread,
        list: [{ emailIds: membership, id: "thread" }],
      },
    });

    const firstPage = await reader.getConversation({
      anchorMessageId: id.message("m-100"),
      limit: CONVERSATION_PAGE_SIZE,
    });
    expect(firstPage.nextCursor).toMatch(/^25\.[A-Za-z0-9_-]{43}$/u);
    if (!firstPage.nextCursor) throw new Error("Expected a second page.");
    const page = await reader.getConversation({
      anchorMessageId: id.message("m-100"),
      cursor: firstPage.nextCursor,
      limit: CONVERSATION_PAGE_SIZE,
    });

    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toMatch(/^50\.[A-Za-z0-9_-]{43}$/u);
    expect(page.total).toBe(100);
    expect(page.truncated).toBe(true);
    expect(requests[5]?.[0]?.[1]).toMatchObject({ ids: bounded });
  });

  it.each(["-1", "01", "1.5", "word", "101"])(
    "rejects invalid provider cursor %s before a provider request",
    async (cursor) => {
      const { reader, request } = readerFor(resultSet());
      await expect(
        reader.getConversation({
          anchorMessageId: id.message("anchor"),
          cursor,
          limit: CONVERSATION_PAGE_SIZE,
        }),
      ).rejects.toThrow("The conversation could not be loaded.");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects a later page when exact Thread membership changed", async () => {
    const { reader } = readerFor(resultSet());
    await expect(reader.getConversation({
      anchorMessageId: id.message("anchor"),
      cursor: `1.${"x".repeat(43)}`,
      limit: CONVERSATION_PAGE_SIZE,
    })).rejects.toThrow("The conversation could not be loaded.");
  });

});
