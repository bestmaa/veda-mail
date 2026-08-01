import { rm } from "node:fs/promises";
import { Readable } from "node:stream";

import type { ImapFlow, MessageStructureObject } from "imapflow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeImapClient: vi.fn(),
  connectImapClient: vi.fn(),
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: mocks.closeImapClient,
  connectImapClient: mocks.connectImapClient,
}));

import { MailApplicationService } from "@/application/services/mail-application.service";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { ImapSmtpMailGateway } from "@/infrastructure/providers/imap-smtp/imap-mail.gateway";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { prepareAttachmentArchive } from "@/server/mail/attachment-archive";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { parseStoreZip } from "@/../tests/support/store-zip";
import { receivedScanFixture } from "@/../tests/unit/received-attachment-scan.fixture";

const first = Uint8Array.of(1, 0, 255);
const second = Uint8Array.of(7, 6, 5, 4);
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
const messageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "INBOX",
  uid: 88,
  uidValidity: BigInt(11),
}));
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", size: 3, type: "text/plain" },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "first.bin" },
      encoding: "base64",
      part: "2",
      size: 4,
      type: "application/octet-stream",
    },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "second.bin" },
      encoding: "base64",
      part: "3",
      size: 8,
      type: "application/octet-stream",
    },
  ],
  type: "multipart/mixed",
};
const source = Buffer.from([
  "From: sender@example.com",
  "To: member@example.com",
  "Subject: Archive",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="veda-boundary"',
  "",
  "--veda-boundary",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Body",
  "--veda-boundary",
  "Content-Type: application/octet-stream",
  'Content-Disposition: attachment; filename="first.bin"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(first).toString("base64"),
  "--veda-boundary",
  "Content-Type: application/octet-stream",
  'Content-Disposition: attachment; filename="second.bin"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(second).toString("base64"),
  "--veda-boundary--",
  "",
].join("\r\n"));
const directories: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeImapClient.mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("IMAP Download all scan integration", () => {
  it("revalidates each MIME part and scans decoded bytes before ZIP delivery", async () => {
    const client = {
      download: vi.fn(async (_uid: number, part: string) => ({
        content: Readable.from([
          Buffer.from(part === "2" ? first : second),
        ]),
        meta: {
          contentType: "application/octet-stream",
          expectedSize: part === "2" ? 4 : 8,
        },
      })),
      fetchOne: vi.fn().mockResolvedValue({
        bodyStructure: structure,
        seq: 1,
        source,
        uid: 88,
      }),
      mailboxOpen: vi.fn().mockResolvedValue({
        exists: 1,
        uidValidity: BigInt(11),
      }),
    };
    mocks.connectImapClient.mockResolvedValue(client as unknown as ImapFlow);
    const fixture = await receivedScanFixture();
    directories.push(fixture.directory);
    const release = vi.fn();
    const mail = new MailApplicationService(new ImapSmtpMailGateway(config));

    const stream = await prepareAttachmentArchive({
      connectionId: "imap-archive-connection",
      lease: { release } as AttachmentDownloadLease,
      mail,
      messageId,
      requestSignal: new AbortController().signal,
      scanSpool: fixture.spool,
    });
    const entries = parseStoreZip(
      new Uint8Array(await new Response(stream).arrayBuffer()),
    );

    expect(entries.map(({ bytes, name }) => ({ bytes, name }))).toEqual([
      { bytes: first, name: "first.bin" },
      { bytes: second, name: "second.bin" },
    ]);
    expect(client.download).toHaveBeenCalledTimes(2);
    expect(client.download).toHaveBeenNthCalledWith(
      1,
      88,
      "2",
      expect.objectContaining({ uid: true }),
    );
    expect(client.download).toHaveBeenNthCalledWith(
      2,
      88,
      "3",
      expect.objectContaining({ uid: true }),
    );
    expect(mocks.closeImapClient).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledOnce();
    expect(fixture.spool.stats()).toEqual({ bytes: 0, records: 0 });
  });
});
