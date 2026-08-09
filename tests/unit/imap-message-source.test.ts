import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";

const mocks = vi.hoisted(() => ({ client: {
  fetchOne: vi.fn(), mailboxOpen: vi.fn(),
} }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: vi.fn((_config, operation) => operation(mocks.client)),
}));

import { downloadImapMessageSource } from "@/infrastructure/providers/imap-smtp/imap-message-source";

const config = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls" as const,
  secret: "private", smtpHost: "smtp.example.com", smtpMaxMessageBytes: "50000000",
  smtpPort: "465", smtpSecurity: "tls" as const, username: "member@example.com",
};
const messageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "Inbox", uid: 42, uidValidity: BigInt(7),
}));
const source = Buffer.from("Subject: Exact\r\n\r\nBody");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(7) });
  mocks.client.fetchOne.mockResolvedValue({ size: source.byteLength, source, uid: 42 });
});

describe("IMAP message source export", () => {
  it("pins mailbox UIDVALIDITY and requires a complete exact source", async () => {
    const result = await downloadImapMessageSource(config, {
      maxBytes: 50_000, messageId,
    });
    await expect(new Response(result.body).text()).resolves.toBe(
      "Subject: Exact\r\n\r\nBody",
    );
    expect(mocks.client.mailboxOpen).toHaveBeenCalledWith("Inbox", { readOnly: true });
    expect(mocks.client.fetchOne).toHaveBeenCalledWith(42, {
      size: true, source: { maxLength: 50_001 }, uid: true,
    }, { uid: true });
  });

  it("fails closed on stale UIDVALIDITY and truncated source", async () => {
    mocks.client.mailboxOpen.mockResolvedValueOnce({ uidValidity: BigInt(8) });
    await expect(downloadImapMessageSource(config, {
      maxBytes: 50_000, messageId,
    })).rejects.toMatchObject({ code: "not_found" });

    mocks.client.fetchOne.mockResolvedValueOnce({
      size: source.byteLength + 1, source, uid: 42,
    });
    await expect(downloadImapMessageSource(config, {
      maxBytes: 50_000, messageId,
    })).rejects.toMatchObject({ code: "provider_failure" });
  });
});
