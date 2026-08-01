import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    capabilities: new Map<string, boolean>([["UIDPLUS", true]]),
    fetchOne: vi.fn(),
    mailboxOpen: vi.fn(),
    messageFlagsAdd: vi.fn(),
    messageDelete: vi.fn(),
  },
  sendMail: vi.fn(),
  withImapClient: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
  },
}));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: mocks.withImapClient,
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { ComposeInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

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

const messageId = (
  overrides: {
    readonly uidValidity?: bigint;
    readonly username?: string;
  } = {},
) =>
  id.message(
    encodeScopedImapMessageId(
      { ...config, username: overrides.username ?? config.username },
      {
        mailbox: "INBOX",
        uid: 77,
        uidValidity: overrides.uidValidity ?? BigInt(123),
      },
    ),
  );

const composeInput = (inReplyTo: ReturnType<typeof messageId>): ComposeInput => ({
  bcc: [],
  body: "Reply",
  cc: [],
  inReplyTo,
  subject: "Re: fixture",
  to: [{ email: "recipient@example.net", name: null }],
});

describe("IMAP writer message identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withImapClient.mockImplementation(
      async (
        _config: ImapSmtpMemberConfig,
        task: (client: ImapFlow) => Promise<unknown>,
      ) => task(mocks.client as unknown as ImapFlow),
    );
    mocks.client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(123),
    });
  });

  it("rejects another account before opening the provider", async () => {
    await expect(
      new ImapMailWriter(config).mutateMessage({
        messageId: messageId({ username: "other@example.com" }),
        type: "set-read",
        value: true,
      }),
    ).rejects.toThrow("Message not found.");
    expect(mocks.withImapClient).not.toHaveBeenCalled();
  });

  it("rejects a stale mutation before changing a reused UID", async () => {
    mocks.client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(124),
    });

    await expect(
      new ImapMailWriter(config).mutateMessage({
        messageId: messageId(),
        type: "set-read",
        value: true,
      }),
    ).rejects.toThrow("Message not found.");
    expect(mocks.client.messageFlagsAdd).not.toHaveBeenCalled();
  });

  it("permanently deletes only the scoped UID after UIDVALIDITY revalidation", async () => {
    mocks.client.messageDelete.mockResolvedValue(true);

    await new ImapMailWriter(config).mutateMessage({
      mailboxId: id.mailbox("INBOX"),
      messageId: messageId(),
      type: "destroy",
    });

    expect(mocks.client.messageDelete).toHaveBeenCalledWith(77, { uid: true });
  });

  it("does not report a missing UID as permanently deleted", async () => {
    mocks.client.messageDelete.mockResolvedValue(false);

    await expect(new ImapMailWriter(config).mutateMessage({
      mailboxId: id.mailbox("INBOX"),
      messageId: messageId(),
      type: "destroy",
    })).rejects.toThrow("Message not found.");
  });

  it("rejects a stale reply before fetching or sending", async () => {
    mocks.client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(124),
    });

    await expect(
      new ImapMailWriter(config).sendMessage(composeInput(messageId())),
    ).rejects.toThrow("message being replied to was not found");
    expect(mocks.client.fetchOne).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
