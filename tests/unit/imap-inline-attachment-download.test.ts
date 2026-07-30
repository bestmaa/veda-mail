import { Readable } from "node:stream";

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
const inlineStructure = (contentId: string): MessageStructureObject => ({
  id: contentId,
  part: "3",
  size: 256,
  type: "image/png",
});
const bindInline = (structure: MessageStructureObject) => {
  const attachment = bindImapReceivedAttachments({
    accountScope: imapAttachmentAccountScope(config),
    messageId,
    structure,
    uidValidity: BigInt(9),
  })[0];
  if (!attachment) throw new Error("Missing inline attachment fixture.");
  return attachment;
};
const fakeClient = (
  structure: MessageStructureObject,
  content = Readable.from([Buffer.from("png")]),
) => ({
  download: vi.fn().mockResolvedValue({
    content,
    meta: { contentType: "image/png", expectedSize: 256 },
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
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
});

describe("IMAP inline attachment download", () => {
  it("downloads the BODYSTRUCTURE-bound private part", async () => {
    const structure = inlineStructure("<logo@example.test>");
    const attachment = bindInline(structure);
    const client = fakeClient(structure);
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    const download = await downloadImapAttachment(config, {
      attachmentId: attachment.metadata.id,
      maxBytes: 16,
      messageId,
    });

    expect(download).toMatchObject({
      mimeType: "image/png",
      name: "attachment.bin",
      size: null,
    });
    expect(client.download).toHaveBeenCalledWith(
      77,
      "3",
      expect.objectContaining({ maxBytes: 17, uid: true }),
    );
    expect(await new Response(download.body).text()).toBe("png");
  });

  it("rejects a handle after authoritative CID metadata changes", async () => {
    const attachment = bindInline(inlineStructure("<logo@example.test>"));
    const client = fakeClient(
      inlineStructure("<replacement@example.test>"),
    );
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    await expect(
      downloadImapAttachment(config, {
        attachmentId: attachment.metadata.id,
        maxBytes: 16,
        messageId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(client.download).not.toHaveBeenCalled();
  });
});
