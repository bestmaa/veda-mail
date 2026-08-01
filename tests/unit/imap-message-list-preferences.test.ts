import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({
  client: {
    download: vi.fn(),
    fetchAll: vi.fn(),
    fetchOne: vi.fn(),
    mailboxOpen: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: ImapSmtpMemberConfig,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(mocks.client as unknown as ImapFlow),
}));

import { ImapMailReader } from "@/infrastructure/providers/imap-smtp/imap-mail.reader";

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
const mailboxId = id.mailbox(encodeMailboxId("INBOX"));

const message = (uid: number) => ({
  envelope: {
    from: [{ address: `sender-${uid}@example.com` }],
    messageId: `message-${uid}@example.com`,
    subject: `Message ${uid}`,
    to: [{ address: "member@example.com" }],
  },
  flags: new Set<string>(),
  internalDate: new Date(`2026-08-0${uid}T10:00:00.000Z`),
  seq: uid,
  size: 100,
  uid,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mailboxOpen.mockResolvedValue({
    exists: 3,
    uidValidity: BigInt(9),
  });
  mocks.client.search.mockResolvedValue([1, 3, 2]);
  mocks.client.fetchAll.mockImplementation(async (uids: number[]) =>
    [...uids].reverse().map(message),
  );
});

describe("IMAP message-list preferences", () => {
  it.each([
    ["newest", [3, 2]],
    ["oldest", [1, 2]],
  ] as const)("opens read-only and maps %s to UID direction", async (
    sort,
    expectedUids,
  ) => {
    const page = await new ImapMailReader(config).listMessages({
      includePreview: true,
      limit: 2,
      mailboxId,
      sort,
    });

    expect(mocks.client.mailboxOpen).toHaveBeenCalledWith("INBOX", {
      readOnly: true,
    });
    expect(mocks.client.fetchAll).toHaveBeenCalledWith(
      expectedUids,
      expect.not.objectContaining({ bodyParts: expect.anything(), source: expect.anything() }),
      { uid: true },
    );
    expect(page.items.map(({ subject }) => subject)).toEqual(
      expectedUids.map((uid) => `Message ${uid}`),
    );
    expect(page.items.every(({ preview }) => preview === "")).toBe(true);
    expect(mocks.client.fetchOne).not.toHaveBeenCalled();
    expect(mocks.client.download).not.toHaveBeenCalled();
  });
});
