import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
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

const email = (preview?: string) => ({
  hasAttachment: false,
  id: "message-a",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: preview ?? "",
  receivedAt: "2026-08-01T10:00:00.000Z",
  size: 100,
  subject: "Preferences fixture",
  threadId: "thread-a",
});

const fixture = (preview?: string) => {
  let calls: readonly JmapMethodCall[] = [];
  const client = {
    getSession: vi.fn().mockResolvedValue(session),
    request: vi.fn().mockImplementation(
      async (nextCalls: readonly JmapMethodCall[]) => {
        calls = nextCalls;
        return { methodResponses: [], sessionState: "session-state" };
      },
    ),
    result: vi.fn().mockImplementation((_response, callId) =>
      callId === "query"
        ? {
            accountId: "account",
            ids: ["message-a"],
            position: 0,
            queryState: "query-state",
            total: 1,
          }
        : {
            accountId: "account",
            list: [email(preview)],
            state: "email-state",
          },
    ),
  } as unknown as StalwartJmapClient;
  return {
    calls: () => calls,
    reader: new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "member@example.com",
    }),
  };
};

describe("Stalwart message-list preferences", () => {
  it.each([
    ["newest", false],
    ["oldest", true],
  ] as const)("maps %s to the exact receivedAt comparator", async (
    sort,
    isAscending,
  ) => {
    const test = fixture("Visible preview");

    await test.reader.listMessages({
      includePreview: true,
      limit: 50,
      mailboxId: id.mailbox("inbox"),
      sort,
    });

    expect(test.calls()[0]).toEqual(["Email/query", {
      accountId: "account",
      calculateTotal: true,
      filter: { inMailbox: "inbox" },
      limit: 50,
      position: 0,
      sort: [{ isAscending, property: "receivedAt" }],
    }, "query"]);
  });

  it("omits the preview property and returns an empty preview when hidden", async () => {
    const test = fixture();

    const page = await test.reader.listMessages({
      includePreview: false,
      limit: 50,
      mailboxId: id.mailbox("inbox"),
      sort: "newest",
    });
    const getCall = test.calls()[1];
    const properties = getCall?.[1]["properties"];

    expect(getCall?.[0]).toBe("Email/get");
    expect(properties).toEqual([
      "id",
      "threadId",
      "mailboxIds",
      "keywords",
      "receivedAt",
      "size",
      "subject",
      "from",
      "to",
      "hasAttachment",
    ]);
    expect(properties).not.toContain("preview");
    expect(page.items[0]?.preview).toBe("");
  });
});
