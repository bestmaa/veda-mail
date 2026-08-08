import type { FetchMessageObject, ImapFlow } from "imapflow";
import { expect, it, vi } from "vitest";

const imap = vi.hoisted(() => ({
  client: {
    capabilities: new Map<string, boolean | number>(),
    fetchAll: vi.fn(), fetchOne: vi.fn(), list: vi.fn(),
    mailboxOpen: vi.fn(), search: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown, task: (client: ImapFlow) => Promise<unknown>,
  ) => task(imap.client as unknown as ImapFlow),
}));

import { CONVERSATION_PAGE_SIZE } from "@/domain/mail/conversation";
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

const message = (input: {
  readonly headers?: string;
  readonly inReplyTo?: string;
  readonly messageId: string;
  readonly uid: number;
}): FetchMessageObject => ({
  envelope: {
    date: new Date(Date.UTC(2026, 7, 1, 0, 0, input.uid)),
    from: [{ address: "sender@example.com" }],
    ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
    messageId: input.messageId, subject: `Message ${input.uid}`,
    to: [{ address: "member@example.com" }],
  },
  flags: new Set(),
  ...(input.headers
    ? { headers: Buffer.from(input.headers) }
    : { source: Buffer.from("\r\n") }),
  internalDate: new Date(Date.UTC(2026, 7, 1, 0, 0, input.uid)),
  seq: input.uid, size: input.uid, uid: input.uid,
});

it("uses a bounded anchor window when a provider returns no header-search hits", async () => {
  const root = message({ messageId: "<root@example.com>", uid: 1 });
  const reply = message({
    headers: "References: <root@example.com>\r\n",
    inReplyTo: "<root@example.com>", messageId: "<reply@example.com>", uid: 2,
  });
  const unrelated = message({ messageId: "<unrelated@example.com>", uid: 3 });
  imap.client.list.mockResolvedValue([{
    delimiter: "/", flags: new Set(), listed: true, name: "INBOX", parent: [],
    parentPath: "", path: "INBOX", pathAsListed: "INBOX", subscribed: true,
  }]);
  imap.client.mailboxOpen.mockResolvedValue({ exists: 3, uidValidity: BigInt(7) });
  imap.client.fetchOne.mockResolvedValue(reply);
  imap.client.search.mockResolvedValue([]);
  imap.client.fetchAll.mockResolvedValue([root, reply, unrelated]);
  const anchorMessageId = id.message(encodeScopedImapMessageId(config, {
    mailbox: "INBOX", uid: 2, uidValidity: BigInt(7),
  }));

  const result = await readImapConversation(config, {
    anchorMessageId, limit: CONVERSATION_PAGE_SIZE,
  });

  expect(result).toMatchObject({ strategy: "references", total: 2, truncated: false });
  expect(result.items.map(({ subject }) => subject)).toEqual(["Message 1", "Message 2"]);
  expect(imap.client.fetchAll).toHaveBeenCalledWith(
    "1:3", expect.objectContaining({ source: { maxLength: 65_540 } }),
  );
});
