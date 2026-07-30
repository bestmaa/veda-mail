import type { ImapFlow, MessageStructureObject } from "imapflow";
import type { ParsedMail } from "mailparser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
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
  encodeScopedImapMessageId(config, {
    mailbox: "INBOX",
    uid: 77,
    uidValidity: BigInt(123),
  }),
);
const source = Buffer.from("bounded MIME source");

const inlineStructure = (count: number): MessageStructureObject => ({
  childNodes: [
    { part: "1", size: 32, type: "text/html" },
    ...Array.from({ length: count }, (_, index) => ({
      id: `<inline-${index}@example.test>`,
      parameters: { name: `inline-${index}.png` },
      part: String(index + 2),
      size: 256,
      type: "image/png",
    })),
  ],
  type: "multipart/related",
});
const htmlReferences = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      `<img src="cid:inline-${index}@example.test" alt="Image ${index}">`,
  ).join("");
const boundAttachments = (structure: MessageStructureObject) =>
  bindImapReceivedAttachments({
    accountScope: imapAttachmentAccountScope(config),
    messageId,
    structure,
    uidValidity: BigInt(123),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectImapClient.mockResolvedValue(mocks.client);
  mocks.client.mailboxOpen.mockResolvedValue({
    exists: 1,
    uidValidity: BigInt(123),
  });
});

describe("IMAP final visible attachment listing", () => {
  it("excludes a successfully rendered inline image", async () => {
    const structure = inlineStructure(1);
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: structure,
      source,
      uid: 77,
    });
    mocks.parse.mockResolvedValue({
      html: htmlReferences(1),
    } as unknown as ParsedMail);

    await expect(
      new ImapMailReader(config).listMessageAttachments({ messageId }),
    ).resolves.toEqual([]);
  });

  it("includes an unreferenced inline image as an attachment fallback", async () => {
    const structure = inlineStructure(1);
    const expected = boundAttachments(structure)[0]?.metadata;
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: structure,
      source,
      uid: 77,
    });
    mocks.parse.mockResolvedValue({
      html: "<p>No image reference</p>",
    } as unknown as ParsedMail);

    const listed = await new ImapMailReader(config).listMessageAttachments({
      messageId,
    });

    expect(listed).toEqual([{ ...expected, disposition: "attachment" }]);
  });

  it("includes only the ninth inline image beyond the render cap", async () => {
    const structure = inlineStructure(9);
    const ninth = boundAttachments(structure)[8]?.metadata;
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: structure,
      source,
      uid: 77,
    });
    mocks.parse.mockResolvedValue({
      html: htmlReferences(9),
    } as unknown as ParsedMail);

    const listed = await new ImapMailReader(config).listMessageAttachments({
      messageId,
    });

    expect(listed).toEqual([{ ...ninth, disposition: "attachment" }]);
  });

  it("honors abort before connection and while parsing fetched source", async () => {
    const beforeFetch = new AbortController();
    beforeFetch.abort();
    await expect(
      new ImapMailReader(config).listMessageAttachments({
        messageId,
        signal: beforeFetch.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.connectImapClient).not.toHaveBeenCalled();

    const structure = inlineStructure(1);
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: structure,
      source,
      uid: 77,
    });
    let resolveParse!: (value: ParsedMail) => void;
    mocks.parse.mockImplementationOnce(
      () =>
        new Promise<ParsedMail>((resolve) => {
          resolveParse = resolve;
        }),
    );
    const afterFetch = new AbortController();
    const pending = new ImapMailReader(config).listMessageAttachments({
      messageId,
      signal: afterFetch.signal,
    });
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledOnce());
    afterFetch.abort();
    expect(mocks.client.close).toHaveBeenCalledOnce();
    resolveParse({ html: false } as ParsedMail);
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(mocks.closeImapClient).toHaveBeenCalledOnce();
  });

  it("rejects a body response for a different UID before parsing", async () => {
    mocks.client.fetchOne.mockResolvedValue({
      bodyStructure: inlineStructure(1),
      source,
      uid: 78,
    });

    await expect(
      new ImapMailReader(config).listMessageAttachments({ messageId }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
