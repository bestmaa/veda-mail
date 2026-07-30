import type { ImapFlow, MessageStructureObject } from "imapflow";
import type { ParsedMail } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  closeImapClient: vi.fn(),
  connectImapClient: vi.fn(),
  client: {
    close: vi.fn(),
    fetchOne: vi.fn(),
    mailboxOpen: vi.fn(),
  },
  parse: vi.fn(),
}));

vi.mock("mailparser", () => ({ simpleParser: mocks.parse }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: mocks.closeImapClient,
  connectImapClient: mocks.connectImapClient,
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
  encodeMessageId({ mailbox: "INBOX", uid: 77 }),
);
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", size: 4, type: "text/plain" },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "verified.pdf" },
      part: "2",
      size: 42,
      type: "application/pdf",
    },
  ],
  type: "multipart/mixed",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mailboxOpen.mockResolvedValue({
    exists: 1,
    uidValidity: BigInt(123),
  });
  mocks.connectImapClient.mockResolvedValue(mocks.client);
  mocks.client.fetchOne.mockResolvedValue({
    bodyStructure: structure,
    envelope: { subject: "Fixture" },
    flags: new Set(),
    internalDate: new Date("2026-07-29T00:00:00.000Z"),
    seq: 1,
    size: 256,
    source: Buffer.from("MIME source"),
    uid: 77,
  });
  mocks.parse.mockResolvedValue({
    attachments: [
      {
        cid: "attacker-cid",
        contentType: "text/html",
        filename: "attacker.html",
        size: 9_999,
      },
    ],
    html: false,
    text: "Safe body",
  } as unknown as ParsedMail);
});

describe("IMAP message reader attachments", () => {
  it("opens read-only and maps only UIDVALIDITY-bound BODYSTRUCTURE parts", async () => {
    const detail = await new ImapMailReader(config).getMessage(messageId);
    const verified = bindImapReceivedAttachments({
      accountScope: imapAttachmentAccountScope(config.username),
      messageId,
      structure,
      uidValidity: BigInt(123),
    })[0]?.metadata;

    expect(mocks.client.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(detail.attachments).toEqual([verified]);
    expect(JSON.stringify(detail.attachments)).not.toContain("attacker-cid");
    expect(detail.textBody).toBe("Safe body");
  });

  it("rejects a provider response for a different UID", async () => {
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: structure,
      seq: 1,
      source: Buffer.from("MIME source"),
      uid: 78,
    });

    await expect(
      new ImapMailReader(config).getMessage(messageId),
    ).rejects.toThrow("Message not found.");
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("lists attachment metadata without fetching or parsing message source", async () => {
    const controller = new AbortController();
    const listed = await new ImapMailReader(config).listMessageAttachments({
      messageId,
      signal: controller.signal,
    });
    const verified = bindImapReceivedAttachments({
      accountScope: imapAttachmentAccountScope(config.username),
      messageId,
      structure,
      uidValidity: BigInt(123),
    })[0]?.metadata;

    expect(listed).toEqual([{ ...verified, size: null }]);
    expect(mocks.client.fetchOne).toHaveBeenCalledWith(
      77,
      { bodyStructure: true, uid: true },
      { uid: true },
    );
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("does not treat transfer-encoded BODYSTRUCTURE size as decoded bytes", async () => {
    const encodedLargeStructure: MessageStructureObject = {
      childNodes: [
        {
          disposition: "attachment",
          dispositionParameters: { filename: "decoded-safe.bin" },
          encoding: "base64",
          part: "1",
          size: 55 * 1024 * 1024,
          type: "application/octet-stream",
        },
      ],
      type: "multipart/mixed",
    };
    mocks.client.fetchOne.mockResolvedValueOnce({
      bodyStructure: encodedLargeStructure,
      uid: 77,
    });

    const listed = await new ImapMailReader(config).listMessageAttachments({
      messageId,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: "decoded-safe.bin",
      size: null,
    });
  });

  it("catches cancellation during the connection-to-listener handoff", async () => {
    const controller = new AbortController();
    mocks.connectImapClient.mockImplementationOnce(async () => {
      controller.abort();
      return mocks.client;
    });

    await expect(
      new ImapMailReader(config).listMessageAttachments({
        messageId,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.client.mailboxOpen).not.toHaveBeenCalled();
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });

  it("catches cancellation after mailbox open or metadata fetch", async () => {
    const afterOpen = new AbortController();
    mocks.client.mailboxOpen.mockImplementationOnce(async () => {
      afterOpen.abort();
      return { exists: 1, uidValidity: BigInt(123) };
    });
    await expect(
      new ImapMailReader(config).listMessageAttachments({
        messageId,
        signal: afterOpen.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.client.fetchOne).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.connectImapClient.mockResolvedValue(mocks.client);
    mocks.client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(123),
    });
    const afterFetch = new AbortController();
    mocks.client.fetchOne.mockImplementationOnce(async () => {
      afterFetch.abort();
      return {
        bodyStructure: structure,
        uid: 77,
      };
    });
    await expect(
      new ImapMailReader(config).listMessageAttachments({
        messageId,
        signal: afterFetch.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });

  it("preserves IMAP metadata lookup timeout semantics", async () => {
    mocks.client.mailboxOpen.mockRejectedValueOnce(
      Object.assign(new Error("private server address"), {
        code: "ETIMEOUT",
      }),
    );

    await expect(
      new ImapMailReader(config).listMessageAttachments({ messageId }),
    ).rejects.toMatchObject({
      code: "timeout",
      message: expect.not.stringContaining("private server"),
    });
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });
});
