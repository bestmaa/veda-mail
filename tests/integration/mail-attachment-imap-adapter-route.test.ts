import { Readable } from "node:stream";

import type { ImapFlow, MessageStructureObject } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeImapClient: vi.fn(),
  connectImapClient: vi.fn(),
  connection: { id: "imap-route-connection" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: mocks.closeImapClient,
  connectImapClient: mocks.connectImapClient,
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/route";
import { MailApplicationService } from "@/application/services/mail-application.service";
import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { ImapSmtpMailGateway } from "@/infrastructure/providers/imap-smtp/imap-mail.gateway";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const bytes = Uint8Array.of(9, 0, 8, 255, 7);
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
const messageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "INBOX",
  uid: 77,
  uidValidity: BigInt(9),
}));
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", size: 3, type: "text/plain" },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "route-report.bin" },
      encoding: "base64",
      part: "2",
      size: 999_999,
      type: "application/octet-stream",
    },
  ],
  type: "multipart/mixed",
};
const attachmentId = bindImapReceivedAttachments({
  accountScope: imapAttachmentAccountScope(config),
  messageId,
  structure,
  uidValidity: BigInt(9),
})[0]?.metadata.id;
if (!attachmentId) throw new Error("Missing IMAP attachment fixture.");

const request = (
  selectedAttachmentId: string = attachmentId,
  init: RequestInit = {},
) => new Request(
  `${origin}/api/v1/mail/messages/${messageId}/attachments/${selectedAttachmentId}`,
  {
    ...init,
    headers: {
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
      ...init.headers,
    },
  },
);
const context = (selectedAttachmentId: string = attachmentId) => ({
  params: Promise.resolve({
    attachmentId: selectedAttachmentId,
    messageId,
  }),
});

const providerClient = () => ({
  download: vi.fn().mockResolvedValue({
    content: Readable.from([Buffer.from(bytes.slice(0, 2)), Buffer.from(bytes.slice(2))]),
    meta: { contentType: "application/octet-stream", expectedSize: 999_999 },
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
  mocks.closeImapClient.mockResolvedValue(undefined);
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue(
    new MailApplicationService(new ImapSmtpMailGateway(config)),
  );
});

describe("IMAP attachment route adapter integration", () => {
  it("gates scope, revalidates the opaque ID, and preserves decoded bytes", async () => {
    const client = providerClient();
    mocks.connectImapClient.mockResolvedValue(client as unknown as ImapFlow);

    const stale = await GET(request(attachmentId, {
      headers: { "x-veda-mail-session-scope": "stale-scope" },
    }), context());
    expect(stale.status).toBe(409);
    expect(mocks.connectImapClient).not.toHaveBeenCalled();

    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(client.fetchOne).toHaveBeenCalledWith(
      77,
      { bodyStructure: true, uid: true },
      { uid: true },
    );
    expect(client.download).toHaveBeenCalledWith(
      77,
      "2",
      expect.objectContaining({ uid: true }),
    );
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });

  it("rejects a guessed opaque ID after metadata revalidation", async () => {
    const client = providerClient();
    mocks.connectImapClient.mockResolvedValue(client as unknown as ImapFlow);
    const guessed = "message-attachment-guessed";

    const response = await GET(request(guessed), context(guessed));

    expect(response.status).toBe(404);
    expect(client.fetchOne).toHaveBeenCalledOnce();
    expect(client.download).not.toHaveBeenCalled();
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });

  it("maps a real adapter connection timeout without leaking details", async () => {
    mocks.connectImapClient.mockRejectedValue(Object.assign(
      new Error("secret IMAP endpoint detail"),
      { code: "ETIMEDOUT" },
    ));

    const response = await GET(request(), context());
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(504);
    expect(payload).toContain("ATTACHMENT_PROVIDER_TIMEOUT");
    expect(payload).not.toContain("secret IMAP endpoint detail");
  });
});
