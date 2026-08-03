import type { FetchMessageObject, ImapFlow, ListResponse } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  client: {
    capabilities: new Map<string, boolean | number>(),
    fetchAll: vi.fn(), fetchOne: vi.fn(), list: vi.fn(),
    mailboxOpen: vi.fn(), search: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(provider.client as unknown as ImapFlow),
}));

import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";
import { ImapSmtpProviderModule } from "@/infrastructure/providers/imap-smtp/imap-smtp-provider.module";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400", smtpPort: "465", smtpSecurity: "tls",
  username: "member@example.com",
};

const listedMailbox: ListResponse = {
  delimiter: "/", flags: new Set(), listed: true, name: "INBOX",
  parent: [], parentPath: "", path: "INBOX", pathAsListed: "INBOX",
  subscribed: true,
};

const fixture = (uid: number): FetchMessageObject => ({
  envelope: {
    date: new Date(`2026-08-${String(31 - uid).padStart(2, "0")}T00:00:00.000Z`),
    from: [{ address: "sender@example.com" }],
    ...(uid === 1 ? {} : { inReplyTo: "<message-1@example.com>" }),
    messageId: `<message-${uid}@example.com>`,
    subject: `Message ${uid}`,
    to: [{ address: "member@example.com" }],
  },
  flags: new Set(),
  ...(uid === 1 ? {} : { headers: Buffer.from(
    "References: <message-1@example.com>\r\n",
  ) }),
  internalDate: new Date(
    `2026-08-${String(31 - uid).padStart(2, "0")}T00:00:00.000Z`,
  ),
  seq: uid, size: uid, uid,
});

const anchorMessageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "INBOX", uid: 1, uidValidity: BigInt(9),
}));

beforeEach(() => {
  vi.clearAllMocks();
  provider.client.capabilities = new Map();
  provider.client.list.mockResolvedValue([listedMailbox]);
  provider.client.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(9) });
  provider.client.fetchOne.mockResolvedValue(fixture(1));
  provider.client.search.mockResolvedValue(
    Array.from({ length: 30 }, (_, index) => index + 1),
  );
  provider.client.fetchAll.mockImplementation(async (uids: readonly number[]) =>
    uids.map(fixture));
});

describe("IMAP conversation provider contract", () => {
  it("advertises threading only with a callable bounded backend", async () => {
    expect(new ImapSmtpProviderModule().manifest.capabilities.supportsThreads)
      .toBe(true);

    const reader = new ImapMailReader(config);
    const first = await reader.getConversation({
      anchorMessageId, limit: CONVERSATION_PAGE_SIZE,
    });
    expect(first.nextCursor).toMatch(/^25\.[A-Za-z0-9_-]{43}$/u);
    const second = await reader.getConversation({
      anchorMessageId, cursor: first.nextCursor!,
      limit: CONVERSATION_PAGE_SIZE,
    });

    expect(first).toMatchObject({
      anchorMessageId, strategy: "references", total: 30,
    });
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map(({ receivedAt }) => receivedAt))
      .toEqual([...first.items, ...second.items]
        .map(({ receivedAt }) => receivedAt).toSorted());
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size)
      .toBe(30);
  });
});
