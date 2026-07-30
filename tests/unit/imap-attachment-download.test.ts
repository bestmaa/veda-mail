import { PassThrough, Readable } from "node:stream";

import type { ImapFlow, MessageStructureObject } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: mocks.close,
  connectImapClient: mocks.connect,
}));

import { downloadImapAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";

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
    uidValidity: BigInt(9),
  }),
);
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", size: 3, type: "text/plain" },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "report.pdf" },
      encoding: "base64",
      part: "2",
      size: 999_999,
      type: "application/pdf",
    },
  ],
  type: "multipart/mixed",
};

const attachmentId = (uidValidity = BigInt(9)) => {
  const attachment = bindImapReceivedAttachments({
    accountScope: imapAttachmentAccountScope(config),
    messageId,
    structure,
    uidValidity,
  })[0];
  if (!attachment) throw new Error("Missing attachment fixture.");
  return attachment.metadata.id;
};

const fakeClient = (content: Readable = Readable.from([Buffer.from("file")])) => {
  const client = {
    download: vi.fn().mockResolvedValue({
      content,
      meta: { contentType: "application/pdf", expectedSize: 999_999 },
    }),
    fetchOne: vi.fn().mockResolvedValue({
      bodyStructure: structure,
      seq: 1,
      uid: 77,
    }),
    mailboxOpen: vi.fn().mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(9),
    }),
  };
  return client;
};

const input = (overrides: Record<string, unknown> = {}) => ({
  attachmentId: attachmentId(),
  maxBytes: 16,
  messageId,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
});

describe("IMAP attachment download", () => {
  it("revalidates metadata and streams decoded bytes without setting Seen", async () => {
    const client = fakeClient();
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    const download = await downloadImapAttachment(config, input());

    expect(download).toMatchObject({ name: "report.pdf", size: null });
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(client.fetchOne).toHaveBeenCalledWith(
      77,
      { bodyStructure: true, uid: true },
      { uid: true },
    );
    expect(client.download).toHaveBeenCalledWith(77, "2", {
      chunkSize: 64 * 1024,
      maxBytes: 17,
      uid: true,
    });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(await new Response(download.body).text()).toBe("file");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects stale UIDVALIDITY before downloading the part", async () => {
    const client = fakeClient();
    client.mailboxOpen.mockResolvedValue({
      exists: 1,
      uidValidity: BigInt(10),
    });
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    await expect(
      downloadImapAttachment(config, input()),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(client.fetchOne).not.toHaveBeenCalled();
    expect(client.download).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects a wrong scoped ID before downloading the part", async () => {
    const client = fakeClient();
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);
    const wrongId = bindImapReceivedAttachments({
      accountScope: imapAttachmentAccountScope({
        ...config,
        username: "other@example.com",
      }),
      messageId,
      structure,
      uidValidity: BigInt(9),
    })[0]?.metadata.id;

    await expect(
      downloadImapAttachment(config, input({ attachmentId: wrongId })),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(client.download).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("detects decoded content that exceeds the byte limit", async () => {
    const client = fakeClient(Readable.from([Buffer.alloc(5)]));
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);
    const download = await downloadImapAttachment(
      config,
      input({ maxBytes: 4 }),
    );

    await expect(
      new Response(download.body).arrayBuffer(),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
    expect(client.download).toHaveBeenCalledWith(
      77,
      "2",
      expect.objectContaining({ maxBytes: 5 }),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("cancels the IMAP stream and closes the client exactly once", async () => {
    const providerStream = new PassThrough();
    const client = fakeClient(providerStream);
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    const download = await downloadImapAttachment(config, input());
    await download.body.cancel("browser stopped");

    expect(providerStream.destroyed).toBe(true);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("maps request abort while waiting for provider bytes", async () => {
    const providerStream = new PassThrough();
    const client = fakeClient(providerStream);
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);
    const controller = new AbortController();
    const download = await downloadImapAttachment(
      config,
      input({ signal: controller.signal }),
    );

    const read = download.body.getReader().read();
    controller.abort();
    await expect(read).rejects.toMatchObject({ code: "aborted" });
    expect(providerStream.destroyed).toBe(true);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rejects pre-aborted and malformed requests before connecting", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadImapAttachment(config, input({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: "aborted" });
    await expect(
      downloadImapAttachment(
        config,
        input({ messageId: id.message("not-an-imap-reference") }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      downloadImapAttachment(config, input({ maxBytes: 0 })),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("maps a provider connection timeout without leaking its error", async () => {
    mocks.connect.mockRejectedValue(
      Object.assign(new Error("secret provider detail"), {
        code: "ETIMEDOUT",
      }),
    );

    await expect(
      downloadImapAttachment(config, input()),
    ).rejects.toMatchObject({
      code: "timeout",
      message: "The mail provider attachment download timed out.",
    });
  });
});
