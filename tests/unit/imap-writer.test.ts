import { simpleParser } from "mailparser";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (message: { readonly raw: Buffer }) => {
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
      list: () => Promise<
        readonly { path: string; specialUse: string }[]
      >;
    }) => Promise<unknown>,
  ) =>
    task({
      append: async () => ({ uid: 1 }),
      list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
    }),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { ComposeInput } from "@/domain/mail/mail";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
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
  it("uses the authenticated sender domain in the Message-ID", async () => {
    await new ImapMailWriter(config).sendMessage(input);

    const submitted = mocks.sendMail.mock.calls[0]?.[0];
    if (!submitted) throw new Error("No message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(parsed.messageId).toMatch(
      /^<[0-9a-f-]{36}@example\.com>$/,
    );
  });
});
