import type { FetchMessageObject, ImapFlow, ListResponse } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const imap = vi.hoisted(() => ({
  client: {
    capabilities: new Map<string, boolean | number>(),
    fetchAll: vi.fn(),
    fetchOne: vi.fn(),
    list: vi.fn(),
    mailboxOpen: vi.fn(),
    search: vi.fn(),
  },
  mailbox: "INBOX",
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(imap.client as unknown as ImapFlow),
}));

import {
  CONVERSATION_PAGE_SIZE,
  type ConversationQuery,
} from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { readImapConversation } from "@/infrastructure/providers/imap-smtp/imap-conversation.reader";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400", smtpPort: "465", smtpSecurity: "tls",
  username: "member@example.com",
};

const mailbox = (path: string): ListResponse => ({
  delimiter: "/", flags: new Set(), listed: true, name: path,
  parent: [], parentPath: "", path, pathAsListed: path, subscribed: true,
});

const message = (input: {
  readonly emailId?: string;
  readonly headers?: string;
  readonly inReplyTo?: string;
  readonly messageId?: string;
  readonly receivedAt?: string;
  readonly threadId?: string;
  readonly uid: number;
}): FetchMessageObject => {
  const receivedAt = input.receivedAt ?? new Date(
    Date.UTC(2026, 7, 1) + input.uid * 1_000,
  ).toISOString();
  return {
  ...(input.emailId ? { emailId: input.emailId } : {}),
  envelope: {
    date: new Date(receivedAt),
    from: [{ address: "sender@example.com", name: "Sender" }],
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    subject: `Message ${input.uid}`,
    to: [{ address: "member@example.com" }],
  },
  flags: new Set(),
  ...(input.headers ? { headers: Buffer.from(input.headers) } : {}),
  internalDate: new Date(receivedAt),
  seq: input.uid,
  size: input.uid,
  ...(input.threadId ? { threadId: input.threadId } : {}),
  uid: input.uid,
  };
};

const anchorId = (mailboxPath = "INBOX", uidValidity = BigInt(7)) =>
  id.message(encodeScopedImapMessageId(config, {
    mailbox: mailboxPath, uid: 1, uidValidity,
  }));

const query = (
  anchorMessageId = anchorId(), cursor?: string,
): ConversationQuery => ({
  anchorMessageId,
  ...(cursor ? { cursor } : {}),
  limit: CONVERSATION_PAGE_SIZE,
});

beforeEach(() => {
  vi.clearAllMocks();
  imap.client.capabilities = new Map();
  imap.client.list.mockResolvedValue([mailbox("INBOX")]);
  imap.client.mailboxOpen.mockImplementation(async (path: string) => {
    imap.mailbox = path;
    return { uidValidity: BigInt(path === "Archive" ? 8 : 7) };
  });
  imap.client.search.mockResolvedValue([]);
  imap.client.fetchAll.mockResolvedValue([]);
});

describe("IMAP conversation reader", () => {
  it("rejects a foreign or stale scoped anchor before conversation searches", async () => {
    const foreign = encodeScopedImapMessageId(
      { ...config, username: "other@example.com" },
      { mailbox: "INBOX", uid: 1, uidValidity: BigInt(7) },
    );
    await expect(readImapConversation(config, query(id.message(foreign))))
      .rejects.toThrow("Message not found");
    expect(imap.client.list).not.toHaveBeenCalled();

    await expect(readImapConversation(config, query(anchorId("INBOX", BigInt(6)))))
      .rejects.toThrow("Message not found");
    expect(imap.client.fetchOne).not.toHaveBeenCalled();
    expect(imap.client.search).not.toHaveBeenCalled();
  });

  it("uses exact native THREADID, verifies hits, de-duplicates provider copies, and sorts", async () => {
    imap.client.capabilities = new Map([["OBJECTID", true]]);
    imap.client.list.mockResolvedValue([mailbox("INBOX"), mailbox("Archive")]);
    const anchor = message({
      emailId: "email-anchor", messageId: "<anchor@example.com>",
      receivedAt: "2026-08-03T12:00:00.000Z", threadId: "thread-7", uid: 1,
    });
    imap.client.fetchOne.mockResolvedValue(anchor);
    imap.client.search.mockImplementation(async () =>
      imap.mailbox === "INBOX" ? [1, 2, 3] : [10, 11]);
    imap.client.fetchAll.mockImplementation(async (uids: readonly number[]) =>
      uids.map((uid) => {
        if (uid === 1) return anchor;
        if (uid === 2) return message({
          emailId: "email-second", messageId: "<second@example.com>",
          receivedAt: "2026-08-03T10:00:00.000Z", threadId: "thread-7", uid,
        });
        if (uid === 3) return message({
          emailId: "wrong", messageId: "<wrong@example.com>",
          threadId: "other-thread", uid,
        });
        if (uid === 10) return message({
          emailId: "email-second", messageId: "<second@example.com>",
          receivedAt: "2026-08-03T10:00:00.000Z", threadId: "thread-7", uid,
        });
        return message({
          emailId: "email-third", messageId: "<third@example.com>",
          receivedAt: "2026-08-03T11:00:00.000Z", threadId: "thread-7", uid,
        });
      }));

    const result = await readImapConversation(config, query());

    expect(result.strategy).toBe("native");
    expect(result.items.map(({ subject }) => subject)).toEqual([
      "Message 2", "Message 11", "Message 1",
    ]);
    expect(result.total).toBe(3);
    expect(imap.client.search).toHaveBeenCalledTimes(2);
    expect(imap.client.search).toHaveBeenNthCalledWith(
      1, { threadId: "thread-7" }, { uid: true },
    );
  });

  it("handles duplicate, missing, and cyclic IDs and rejects substring false positives", async () => {
    const anchor = message({
      headers: "References: <root@example.com> <reply@example.com>\r\n",
      messageId: "<anchor@example.com>", uid: 1,
    });
    const reply = message({
      headers: "References: <root@example.com> <anchor@example.com>\r\n",
      inReplyTo: "<anchor@example.com>", messageId: "<reply@example.com>",
      uid: 2,
    });
    const missingId = message({
      headers: "References: <reply@example.com>\r\n",
      inReplyTo: "<reply@example.com>", uid: 3,
    });
    const falsePositive = message({
      headers: "References: <not-anchor@example.com>\r\n",
      messageId: "<evil@example.com>", uid: 4,
    });
    imap.client.fetchOne.mockResolvedValue(anchor);
    imap.client.search
      .mockResolvedValueOnce([1, 2, 2, 3, 4])
      .mockResolvedValueOnce([2, 3])
      .mockResolvedValue([]);
    imap.client.fetchAll.mockImplementation(async (uids: readonly number[]) =>
      uids.map((uid) => ({ 1: anchor, 2: reply, 3: missingId, 4: falsePositive }[uid]!)));

    const result = await readImapConversation(config, query());

    expect(result.strategy).toBe("references");
    expect(result.items.map(({ subject }) => subject)).toEqual([
      "Message 1", "Message 2", "Message 3",
    ]);
    expect(result.items).toHaveLength(3);
    expect(imap.client.search.mock.calls.length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(imap.client.search.mock.calls[0]?.[0]))
      .not.toContain("not-anchor@example.com");
  });

  it("caps readable mailboxes at 32 and exposes truncation", async () => {
    imap.client.fetchOne.mockResolvedValue(message({
      messageId: "<anchor@example.com>", uid: 1,
    }));
    imap.client.list.mockResolvedValue([
      mailbox("INBOX"),
      ...Array.from({ length: 40 }, (_, index) => mailbox(`Folder-${index}`)),
    ]);

    const result = await readImapConversation(config, query());

    expect(result.truncated).toBe(true);
    expect(imap.client.search).toHaveBeenCalledTimes(32);
    expect(result.items).toHaveLength(1);
  });

  it("never fetches more than the 100-message conversation budget", async () => {
    imap.client.capabilities = new Map([["X-GM-EXT-1", true]]);
    imap.client.fetchOne.mockResolvedValue(message({
      emailId: "anchor", messageId: "<anchor@example.com>",
      threadId: "native-thread", uid: 1,
    }));
    imap.client.search.mockResolvedValue(
      Array.from({ length: 150 }, (_, index) => index + 2),
    );
    imap.client.fetchAll.mockImplementation(async (uids: readonly number[]) =>
      uids.map((uid) => message({
        emailId: `email-${uid}`, messageId: `<message-${uid}@example.com>`,
        threadId: "native-thread", uid,
      })));

    const result = await readImapConversation(config, query());

    const fetchedUids = imap.client.fetchAll.mock.calls[0]?.[0] as number[];
    expect(fetchedUids).toHaveLength(99);
    expect(result.total).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("rejects malformed cursors and non-standard page sizes", async () => {
    await expect(readImapConversation(config, query(anchorId(), "01")))
      .rejects.toThrow("Invalid conversation cursor");
    await expect(readImapConversation(config, {
      anchorMessageId: anchorId(), limit: 24 as 25,
    })).rejects.toThrow("Invalid conversation page size");
    expect(imap.client.list).not.toHaveBeenCalled();
  });
});
