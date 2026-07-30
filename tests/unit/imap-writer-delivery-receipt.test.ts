import { simpleParser } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(async () => ({
    uid: 1,
    uidValidity: BigInt(123),
  })),
  sendMail: vi.fn(async (message: unknown): Promise<unknown> => {
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
      append: typeof mocks.append;
      list: () => Promise<readonly { path: string; specialUse: string }[]>;
      mailboxOpen: () => Promise<{ exists: number; uidValidity: bigint }>;
    }) => Promise<unknown>,
  ) =>
    task({
      append: mocks.append,
      list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
      mailboxOpen: async () => ({
        exists: 1,
        uidValidity: BigInt(123),
      }),
    }),
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
  bcc: [{ email: "Hidden@Example.net", name: null }],
  body: "Hello",
  cc: [{ email: "Copy@Example.net", name: null }],
  subject: "Delivery receipt",
  to: [{ email: "Recipient@Example.net", name: null }],
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

describe("IMAP/SMTP recipient delivery receipt", () => {
  beforeEach(() => {
    mocks.append.mockClear();
    mocks.sendMail.mockReset();
    mocks.sendMail.mockResolvedValue({ messageId: "provider-message" });
  });

  it("returns accepted when the provider rejects no submitted address", async () => {
    mocks.sendMail.mockResolvedValueOnce({
      messageId: "provider-message",
      rejected: ["unsubmitted@example.net"],
    });

    const receipt = await writer().sendMessage(input);

    expect(receipt.deliveryStatus).toBe("accepted");
    expect(receipt.rejectedRecipients).toEqual([]);
  });

  it("returns a deduplicated submitted subset and keeps BCC out of MIME", async () => {
    mocks.sendMail.mockResolvedValueOnce({
      messageId: "provider-message",
      rejected: [
        "hidden@example.net",
        "COPY@example.net",
        "copy@example.net",
        "unsubmitted@example.net",
      ],
    });

    const receipt = await writer().sendMessage(input);
    const submitted = mocks.sendMail.mock.calls[0]?.[0] as
      | { readonly raw: Buffer }
      | undefined;
    if (!submitted) throw new Error("No SMTP message was submitted.");
    const parsed = await simpleParser(submitted.raw);

    expect(receipt.deliveryStatus).toBe("partial");
    expect(receipt.rejectedRecipients).toEqual([
      "Copy@Example.net",
      "Hidden@Example.net",
    ]);
    expect(parsed.bcc).toBeUndefined();
    expect(mocks.append).toHaveBeenCalledOnce();
  });

  it("replaces an all-recipient rejection with the safe domain error", async () => {
    mocks.sendMail.mockRejectedValueOnce(
      Object.assign(new Error("Hidden@Example.net was rejected"), {
        cause: new Error("provider detail"),
        code: "EENVELOPE",
        rejected: [
          "recipient@example.net",
          "copy@example.net",
          "hidden@example.net",
        ],
      }),
    );

    const failure = await failureFrom(writer().sendMessage(input));

    expect(failure).toBeInstanceOf(MessageDeliveryRejectedError);
    expect(failure).toMatchObject({
      message: "The mail provider rejected every submitted recipient.",
      name: "MessageDeliveryRejectedError",
    });
    expect(failure).not.toHaveProperty("cause");
    expect(String(failure)).not.toContain("Hidden@Example.net");
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it.each(["ETIMEDOUT", "ESOCKET", "ECONNECTION", "EUNEXPECTED"])(
    "returns recipient-free uncertain for ambiguous SMTP %s failures",
    async (code) => {
      const providerSecret = "Hidden@Example.net provider detail";
      const log = vi.spyOn(console, "error");
      mocks.sendMail.mockRejectedValueOnce(
        Object.assign(new Error(providerSecret), {
          cause: new Error("private transport cause"),
          code,
          rejected: ["hidden@example.net"],
        }),
      );

      const receipt = await writer().sendMessage(input);

      expect(receipt).toMatchObject({
        deliveryStatus: "uncertain",
        rejectedRecipients: [],
        submittedAt: expect.any(String),
      });
      expect(JSON.stringify(receipt)).not.toContain(providerSecret);
      expect(mocks.append).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );

  it.each([
    "EAUTH",
    "ECONFIG",
    "EDNS",
    "EENVELOPE",
    "EMESSAGE",
    "ENOAUTH",
    "EOAUTH2",
    "EPROXY",
    "EREQUIRETLS",
    "ETLS",
  ])(
    "keeps definitive pre-submission SMTP %s failures retryable and safe",
    async (code) => {
      const providerSecret = "Hidden@Example.net private provider detail";
      mocks.sendMail.mockRejectedValueOnce(
        Object.assign(new Error(providerSecret), {
          cause: new Error("private transport cause"),
          code,
          rejected: ["hidden@example.net"],
        }),
      );

      const failure = await failureFrom(writer().sendMessage(input));

      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({
        message: "SMTP could not submit the outgoing message.",
      });
      expect(failure).not.toBeInstanceOf(MessageDeliveryRejectedError);
      expect(failure).not.toHaveProperty("cause");
      expect(String(failure)).not.toContain(providerSecret);
      expect(mocks.append).not.toHaveBeenCalled();
    },
  );

  it("keeps a definitive all-recipient rejection retryable", async () => {
    mocks.sendMail.mockRejectedValueOnce(
      Object.assign(new Error("private provider detail"), {
        code: "ECONNECTION",
        rejected: [
          "recipient@example.net",
          "copy@example.net",
          "hidden@example.net",
        ],
      }),
    );

    const failure = await failureFrom(writer().sendMessage(input));

    expect(failure).toBeInstanceOf(MessageDeliveryRejectedError);
    expect(failure).not.toHaveProperty("cause");
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
