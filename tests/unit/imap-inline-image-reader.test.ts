import type { ImapFlow, MessageStructureObject } from "imapflow";
import type { ParsedMail } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  client: {
    fetchOne: vi.fn(),
    mailboxOpen: vi.fn(),
  },
  parse: vi.fn(),
}));

vi.mock("mailparser", () => ({ simpleParser: mocks.parse }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: vi.fn(),
  connectImapClient: vi.fn(),
  withImapClient: async (
    _config: ImapSmtpMemberConfig,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(mocks.client as unknown as ImapFlow),
}));

import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "provider-secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "Member@Example.com",
};
const messageId = id.message(
  encodeScopedImapMessageId(config, {
    mailbox: "INBOX",
    uid: 77,
    uidValidity: BigInt(123),
  }),
);
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", size: 32, type: "text/html" },
    {
      id: "<logo@example.test>",
      part: "2",
      size: 256,
      type: "image/png",
    },
  ],
  type: "multipart/related",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mailboxOpen.mockResolvedValue({
    exists: 1,
    uidValidity: BigInt(123),
  });
  mocks.client.fetchOne.mockResolvedValue({
    bodyStructure: structure,
    envelope: { subject: "Inline fixture" },
    flags: new Set(),
    internalDate: new Date("2026-07-29T00:00:00.000Z"),
    source: Buffer.from("MIME source"),
    uid: 77,
  });
  mocks.parse.mockResolvedValue({
    attachments: [
      {
        cid: "attacker-cid",
        contentType: "image/png",
        filename: "attacker.png",
      },
    ],
    html:
      '<img src="cid:logo@example.test" alt="Logo">' +
      '<img src="cid:attacker-cid" alt="Tracker">',
    text: "Logo",
  } as unknown as ParsedMail);
});

describe("IMAP inline image reader", () => {
  it("maps only BODYSTRUCTURE-verified CIDs and disables parser rewriting", async () => {
    const detail = await new ImapMailReader(config).getMessage(messageId);
    const [inline] = bindImapReceivedAttachments({
      accountScope: imapAttachmentAccountScope(config),
      messageId,
      structure,
      uidValidity: BigInt(123),
    });
    if (!inline) throw new Error("Missing inline attachment fixture.");

    expect(detail.attachments).toEqual([inline.metadata]);
    expect(detail.htmlBody).toBe(
      `<img data-veda-inline-image="${inline.metadata.id}" alt="Logo" />`,
    );
    expect(detail.htmlBody).not.toContain("attacker-cid");
    expect(JSON.stringify(detail.attachments)).not.toContain(
      "logo@example.test",
    );
    expect(mocks.parse).toHaveBeenCalledWith(expect.any(Buffer), {
      skipHtmlToText: true,
      skipImageLinks: true,
      skipTextToHtml: true,
    });
  });
});
