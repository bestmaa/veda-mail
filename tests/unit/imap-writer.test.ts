import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (message: {
    readonly envelope: {
      readonly from: string;
      readonly to: readonly string[];
    };
    readonly raw: Buffer;
  }) => {
    void message;
    return { messageId: "provider-message" };
  }),
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
      append: () => Promise<{ uid: number }>;
      fetchOne: () => Promise<{
        envelope: { messageId: string };
        headers: Buffer;
      }>;
      list: () => Promise<
        readonly { path: string; specialUse: string }[]
      >;
      mailboxOpen: () => Promise<void>;
    }) => Promise<unknown>,
  ) =>
    task({
      append: async () => ({ uid: 1 }),
      fetchOne: async () => ({
        envelope: { messageId: "<source@example.net>" },
        headers: Buffer.from("References: <parent@example.net>\r\n"),
      }),
      list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
      mailboxOpen: async () => undefined,
    }),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { ComposeInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
import { encodeMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "secret",
  smtpHost: "smtp.example.com",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "Sender@Example.COM",
};

const input: ComposeInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "Writer test",
  to: [{ email: "recipient@example.net", name: null }],
};

describe("IMAP/SMTP writer", () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
  });

  it("uses the authenticated sender domain in the Message-ID", async () => {
    await new ImapMailWriter(config).sendMessage(input);

    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.messageId).toMatch(
      /^<[0-9a-f-]{36}@example\.com>$/,
    );
  });

  it("sets provider-derived reply headers on the MIME message", async () => {
    await new ImapMailWriter(config).sendMessage({
      ...input,
      inReplyTo: id.message(encodeMessageId({ mailbox: "INBOX", uid: 1 })),
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
    await new ImapMailWriter(config).sendMessage({
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
    await new ImapMailWriter(config).sendMessage({
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
});
