import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  assertMessageBytes: vi.fn(async () => undefined),
  mailboxOpen: vi.fn(),
  sendMail: vi.fn(
    async (message: {
      readonly envelope: {
        readonly from: string;
        readonly to: readonly string[];
      };
      readonly raw: Buffer;
    }) => {
      void message;
      return { messageId: "provider-message" };
    },
  ),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: unknown,
    task: (client: {
      append: () => Promise<{
        uid?: number;
        uidValidity?: bigint;
      }>;
      fetchOne: () => Promise<{
        envelope: { messageId: string };
        headers: Buffer;
        uid: number;
      }>;
      list: () => Promise<readonly { path: string; specialUse: string }[]>;
      mailboxOpen: () => Promise<{ exists: number; uidValidity: bigint }>;
    }) => Promise<unknown>,
  ) =>
    task({
      append: mocks.append,
      fetchOne: async () => ({
        envelope: { messageId: "<source@example.net>" },
        headers: Buffer.from("References: <parent@example.net>\r\n"),
        uid: 1,
      }),
      list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
      mailboxOpen: mocks.mailboxOpen,
    }),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { ComposeInput } from "@/domain/mail/mail";
import { OutgoingMessageSizeError } from "@/domain/mail/mail-errors";
import { id } from "@/domain/shared/brand";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import {
  decodeScopedImapMessageId,
  encodeScopedImapMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "0",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "Sender@Example.COM",
};
const writer = () =>
  new ImapMailWriter(config, {
    assertMessageBytes: mocks.assertMessageBytes,
    getMaxAttachmentBytes: async () => 1_024,
  });

const input: ComposeInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "Writer test",
  to: [{ email: "recipient@example.net", name: null }],
};

describe("IMAP/SMTP writer", () => {
  beforeEach(() => {
    mocks.append.mockReset();
    mocks.append.mockResolvedValue({
      uid: 1,
      uidValidity: BigInt(123),
    });
    mocks.assertMessageBytes.mockClear();
    mocks.mailboxOpen.mockReset();
    mocks.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(123),
    });
    mocks.sendMail.mockClear();
  });

  it("uses selected UIDVALIDITY when APPEND resolves a UID without UIDPLUS metadata", async () => {
    mocks.append.mockResolvedValueOnce({ uid: 9 });

    const receipt = await writer().sendMessage(input);

    expect(decodeScopedImapMessageId(config, receipt.id)).toMatchObject({
      mailbox: "Sent",
      uid: 9,
      uidValidity: "123",
    });
    expect(mocks.mailboxOpen).toHaveBeenCalledWith("Sent");
  });
  it("uses the authenticated sender domain in the Message-ID", async () => {
    const receipt = await writer().sendMessage(input);

    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.messageId).toMatch(/^<[0-9a-f-]{36}@example\.com>$/);
    expect(decodeScopedImapMessageId(config, receipt.id)).toMatchObject({
      mailbox: "Sent",
      uid: 1,
      uidValidity: "123",
      version: 1,
    });
  });
  it("sets provider-derived reply headers on the MIME message", async () => {
    await writer().sendMessage({
      ...input,
      inReplyTo: id.message(
        encodeScopedImapMessageId(config, {
          mailbox: "INBOX",
          uid: 1,
          uidValidity: BigInt(123),
        }),
      ),
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.inReplyTo).toBe("<source@example.net>");
    expect(parsed.references).toEqual([
      "<parent@example.net>",
      "<source@example.net>",
    ]);
  });

  it("keeps BCC recipients in the SMTP envelope but out of MIME headers", async () => {
    await writer().sendMessage({
      ...input,
      bcc: [{ email: "hidden@example.net", name: null }],
      cc: [{ email: "copy@example.net", name: null }],
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(submitted.envelope.to).toEqual([
      "recipient@example.net",
      "copy@example.net",
      "hidden@example.net",
    ]);
    const ccText = (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
      .filter((value) => value !== undefined)
      .map((value) => value.text)
      .join(", ");
    expect(ccText).toContain("copy@example.net");
    expect(parsed.bcc).toBeUndefined();
  });

  it("supports a BCC-only SMTP envelope without leaking MIME headers", async () => {
    await writer().sendMessage({
      ...input,
      bcc: [{ email: "hidden@example.net", name: null }],
      to: [],
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(submitted.envelope.to).toEqual(["hidden@example.net"]);
    expect(parsed.to).toBeUndefined();
    expect(parsed.bcc).toBeUndefined();
  });
  it("preserves verified attachment bytes in the outgoing MIME message", async () => {
    const content = Buffer.from([0, 1, 2, 3, 254, 255]);
    await writer().sendMessage({
      ...input,
      attachments: [
        {
          content,
          id: id.attachmentUpload("attachment-upload"),
          mimeType: "application/octet-stream",
          name: "../unsafe.bin",
          sha256: createHash("sha256").update(content).digest("hex"),
          size: content.byteLength,
        },
      ],
    });
    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe(".._unsafe.bin");
    expect(parsed.attachments[0]?.contentType).toBe("application/octet-stream");
    expect(parsed.attachments[0]?.content).toEqual(content);
    expect(mocks.assertMessageBytes).toHaveBeenCalledWith(
      submitted.raw.byteLength,
    );
  });
  it("stops before SMTP when the exact MIME message exceeds SIZE", async () => {
    const content = Buffer.from("provider-size-limit");
    mocks.assertMessageBytes.mockRejectedValueOnce(
      new OutgoingMessageSizeError(),
    );

    await expect(
      writer().sendMessage({
        ...input,
        attachments: [
          {
            content,
            id: id.attachmentUpload("oversized-upload"),
            mimeType: "text/plain",
            name: "oversized.txt",
            sha256: createHash("sha256").update(content).digest("hex"),
            size: content.byteLength,
          },
        ],
      }),
    ).rejects.toThrow("Reduce the message body or attachments");
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});
