import { describe, expect, it } from "vitest";

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
  username: "test@example.com",
};

const email: JmapEmail = {
  bodyValues: { text: { value: "Full body" } },
  from: [{ email: "sender@example.com" }],
  hasAttachment: false,
  id: "message",
  keywords: { $seen: true },
  mailboxIds: { inbox: true },
  preview: "Preview",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 100,
  subject: "Body flags",
  textBody: [{ partId: "text", type: "text/plain" }],
  threadId: "thread",
  to: [{ email: "test@example.com" }],
};

describe("Stalwart reader", () => {
  it("requests bounded text and HTML body values", async () => {
    let calls: readonly JmapMethodCall[] = [];
    const client = {
      getSession: async () => session,
      request: async (nextCalls: readonly JmapMethodCall[]) => {
        calls = nextCalls;
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({ accountId: "account", list: [email], state: "state" }),
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "test@example.com",
    });

    const result = await reader.getMessage(id.message("message"));
    const options = calls[0]?.[1];

    expect(result.textBody).toBe("Full body");
    expect(options).toMatchObject({
      fetchHTMLBodyValues: true,
      fetchTextBodyValues: true,
      maxBodyValueBytes: 2_000_000,
    });
  });

  it("loads provider message identifiers for reply headers", async () => {
    let calls: readonly JmapMethodCall[] = [];
    let replyList = [
      {
        id: "message",
        messageId: ["source@example.com"],
        references: ["parent@example.com"],
      },
    ];
    const client = {
      getSession: async () => session,
      request: async (nextCalls: readonly JmapMethodCall[]) => {
        calls = nextCalls;
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({
        accountId: "account",
        list: replyList,
        state: "state",
      }),
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "test@example.com",
    });

    await expect(reader.getReplyContext(id.message("message"))).resolves.toEqual(
      {
        messageId: "source@example.com",
        references: ["parent@example.com"],
      },
    );
    expect(calls[0]?.[1]).toMatchObject({
      ids: ["message"],
      properties: ["id", "messageId", "references"],
    });

    replyList = [];
    await expect(
      reader.getReplyContext(id.message("message")),
    ).rejects.toThrow("The message being replied to was not found.");
  });
});
