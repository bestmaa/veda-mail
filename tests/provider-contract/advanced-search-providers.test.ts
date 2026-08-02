import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imap = vi.hoisted(() => ({
  client: {
    fetchAll: vi.fn(),
    mailboxOpen: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(imap.client as unknown as ImapFlow),
}));

import { parseMailSearch } from "@/domain/mail/mail-search-parser";
import { id } from "@/domain/shared/brand";
import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  type JmapEmail,
  type JmapMethodCall,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const imapConfig: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400", smtpPort: "465", smtpSecurity: "tls",
  username: "member@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  imap.client.mailboxOpen.mockResolvedValue({ exists: 3, uidValidity: BigInt(1) });
  imap.client.fetchAll.mockResolvedValue([]);
});

describe("advanced search provider contracts", () => {
  it("sends the typed AND filter to JMAP without raw grammar passthrough", async () => {
    let calls: readonly JmapMethodCall[] = [];
    const email: JmapEmail = {
      from: [{ email: "ada@example.com" }], hasAttachment: false, id: "email-1",
      keywords: {}, mailboxIds: { inbox: true }, preview: "Plan",
      receivedAt: "2026-07-02T00:00:00.000Z", size: 100,
      subject: "Release", threadId: "thread-1", to: [],
    };
    const client = {
      getSession: async () => ({
        accounts: { account: { isReadOnly: false, name: "Account" } },
        apiUrl: "https://mail.example.com/jmap", capabilities: {},
        downloadUrl: "https://mail.example.com/download",
        primaryAccounts: { [JMAP_MAIL]: "account" },
        uploadUrl: "https://mail.example.com/upload",
        username: "member@example.com",
      }),
      request: async (next: readonly JmapMethodCall[]) => {
        calls = next;
        return { methodResponses: [], sessionState: "session" };
      },
      result: (_response: unknown, callId: string) => callId === "query"
        ? { accountId: "account", ids: ["email-1"], position: 0,
            queryState: "query-state", total: 1 }
        : { accountId: "account", list: [email], state: "email-state" },
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic", baseUrl: "https://mail.example.com",
      secret: "secret", username: "member@example.com",
    });

    await reader.listMessages({
      includePreview: true, limit: 50, mailboxId: id.mailbox("inbox"),
      search: parseMailSearch('from:ada@example.com subject:"Release" is:unread'),
      sort: "newest",
    });

    expect(calls[0]?.[1]).toMatchObject({
      filter: {
        conditions: [
          { inMailbox: "inbox" }, { from: "ada@example.com" },
          { subject: '"Release"' }, { notKeyword: "$seen" },
        ],
        operator: "AND",
      },
    });
  });

  it("intersects repeated IMAP predicates and fails before unsupported search", async () => {
    imap.client.search
      .mockResolvedValueOnce([1, 2, 3])
      .mockResolvedValueOnce([2, 3]);
    const reader = new ImapMailReader(imapConfig);

    const result = await reader.listMessages({
      includePreview: false, limit: 50,
      mailboxId: id.mailbox(encodeMailboxId("INBOX")),
      search: parseMailSearch("from:ada@example.com from:grace@example.com"),
      sort: "newest",
    });

    expect(imap.client.search.mock.calls).toEqual([
      [{ from: "ada@example.com" }, { uid: true }],
      [{ from: "grace@example.com" }, { uid: true }],
    ]);
    expect(imap.client.fetchAll).toHaveBeenCalledWith(
      [3, 2], expect.any(Object), { uid: true },
    );
    expect(result.total).toBe(2);

    await expect(reader.listMessages({
      includePreview: false, limit: 50,
      mailboxId: id.mailbox(encodeMailboxId("INBOX")),
      search: parseMailSearch("has:attachment"), sort: "newest",
    })).rejects.toThrow("does not support has:attachment search");
    expect(imap.client.search).toHaveBeenCalledTimes(2);
  });
});
