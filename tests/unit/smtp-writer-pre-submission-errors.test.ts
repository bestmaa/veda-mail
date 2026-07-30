import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  imap: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mocks.sendMail }),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async () => {
    mocks.imap();
    throw new Error("Sent append must not run after SMTP failure.");
  },
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
}));

import type { SendMessageInput } from "@/domain/mail/mail";
import { MessageDeliveryRejectedError } from "@/domain/mail/mail-errors";
import { ImapMailWriter } from "@/infrastructure/providers/imap-smtp/imap-mail.writer";
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
  username: "sender@example.com",
};

const input: SendMessageInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "SMTP phase classification",
  to: [{ email: "recipient@example.net", name: null }],
};

const writer = () =>
  new ImapMailWriter(config, {
    assertMessageBytes: async () => undefined,
    getMaxAttachmentBytes: async () => 0,
  });

const failureFrom = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
    return null;
  } catch (error) {
    return error;
  }
};

describe("SMTP pre-submission command classification", () => {
  beforeEach(() => {
    mocks.imap.mockClear();
    mocks.sendMail.mockReset();
  });

  it.each([
    ["ECONNECTION", " EHLO "],
    ["econnection", "api"],
    ["EPROTOCOL", "HELO"],
    ["EPROTOCOL", "LHLO"],
  ])(
    "keeps definite %s/%s pre-submission failures retryable and safe",
    async (code, command) => {
      const privateDetail =
        "421 recipient@example.net required TLS private response";
      mocks.sendMail.mockRejectedValueOnce(
        Object.assign(new Error(privateDetail), {
          cause: new Error("private SMTP cause"),
          code,
          command,
          response: privateDetail,
          responseCode: 421,
        }),
      );

      const failure = await failureFrom(writer().sendMessage(input));

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(MessageDeliveryRejectedError);
      expect(failure).toMatchObject({
        message: "SMTP could not submit the outgoing message.",
      });
      expect(failure).not.toHaveProperty("cause");
      expect(String(failure)).not.toContain(privateDetail);
      expect(mocks.imap).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ECONNECTION", undefined],
    ["ECONNECTION", "CONN"],
    ["ECONNECTION", "DATA"],
    ["EPROTOCOL", "CONN"],
  ])(
    "keeps ambiguous %s/%s failures terminal uncertain",
    async (code, command) => {
      const privateDetail = "421 recipient@example.net private response";
      mocks.sendMail.mockRejectedValueOnce(
        Object.assign(new Error(privateDetail), {
          cause: new Error("private SMTP cause"),
          code,
          command,
          response: privateDetail,
          responseCode: 421,
        }),
      );

      const receipt = await writer().sendMessage(input);

      expect(receipt).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
      });
      expect(JSON.stringify(receipt)).not.toContain(privateDetail);
      expect(mocks.imap).not.toHaveBeenCalled();
    },
  );
});
