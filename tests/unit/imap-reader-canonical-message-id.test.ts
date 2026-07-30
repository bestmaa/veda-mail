import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  client: {
    fetchOne: vi.fn(),
    mailboxOpen: vi.fn(),
  },
  withImapClient: vi.fn(),
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: vi.fn(),
  connectImapClient: vi.fn(),
  withImapClient: mocks.withImapClient,
}));

import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "provider-secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.com",
};

describe("IMAP reader canonical message identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withImapClient.mockImplementation(
      async (
        _config: ImapSmtpMemberConfig,
        task: (client: ImapFlow) => Promise<unknown>,
      ) => task(mocks.client as unknown as ImapFlow),
    );
  });

  it("rejects a base64url alias before provider access", async () => {
    const canonical = encodeScopedImapMessageId(config, {
      mailbox: "INBOX",
      uid: 77,
      uidValidity: BigInt(123),
    });
    const alias = id.message(`${canonical}=`);

    await expect(
      new ImapMailReader(config).getMessage(alias),
    ).rejects.toThrow("Message not found.");
    expect(mocks.withImapClient).not.toHaveBeenCalled();
  });

  it("rejects an identifier from another account before provider access", async () => {
    const otherAccountId = id.message(
      encodeScopedImapMessageId(
        { ...config, username: "other@example.com" },
        {
          mailbox: "INBOX",
          uid: 77,
          uidValidity: BigInt(123),
        },
      ),
    );

    await expect(
      new ImapMailReader(config).getMessage(otherAccountId),
    ).rejects.toThrow("Message not found.");
    expect(mocks.withImapClient).not.toHaveBeenCalled();
  });

  it("rejects a stale UIDVALIDITY before fetching a reused UID", async () => {
    const messageId = id.message(
      encodeScopedImapMessageId(config, {
        mailbox: "INBOX",
        uid: 77,
        uidValidity: BigInt(123),
      }),
    );
    mocks.client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(124),
    });

    await expect(
      new ImapMailReader(config).getMessage(messageId),
    ).rejects.toThrow("Message not found.");
    expect(mocks.client.fetchOne).not.toHaveBeenCalled();
  });
});
