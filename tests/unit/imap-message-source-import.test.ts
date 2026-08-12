import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  mailboxOpen: vi.fn(),
}));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: vi.fn(async (_config, operation) => operation(mocks)),
}));

import { id } from "@/domain/shared/brand";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { importImapMessageSource } from "@/infrastructure/providers/imap-smtp/imap-message-source-import";

const config = {
  imapHost: "mail.example.com", imapPort: "993", imapSecure: true,
  secret: "secret", smtpHost: "mail.example.com", smtpPort: "465",
  smtpSecure: true, username: "member@example.com",
};

beforeEach(() => {
  mocks.append.mockReset();
  mocks.mailboxOpen.mockReset();
  mocks.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(42) });
  mocks.append.mockResolvedValue({ uid: 7, uidValidity: BigInt(42) });
});

describe("IMAP RFC 5322 import", () => {
  it("appends exact bytes and returns a scoped message identity", async () => {
    const source = new TextEncoder().encode("From: a@example.com\r\n\r\nHello\r\n");
    const result = await importImapMessageSource(config as never, {
      mailboxId: id.mailbox(encodeMailboxId("Archive")),
      source,
    });
    expect(mocks.mailboxOpen).toHaveBeenCalledWith("Archive");
    expect(new Uint8Array(mocks.append.mock.calls[0]![1])).toEqual(source);
    expect(result.messageId).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("rejects invalid mailbox IDs, empty files, aborts, and missing APPENDUID", async () => {
    await expect(importImapMessageSource(config as never, {
      mailboxId: id.mailbox("foreign"), source: new Uint8Array([1]),
    })).rejects.toMatchObject({ code: "mailbox_not_found" });
    await expect(importImapMessageSource(config as never, {
      mailboxId: id.mailbox(encodeMailboxId("Inbox")), source: new Uint8Array(),
    })).rejects.toMatchObject({ code: "size_limit_exceeded" });
    await expect(importImapMessageSource(config as never, {
      mailboxId: id.mailbox(encodeMailboxId("Inbox")),
      signal: AbortSignal.abort(), source: new Uint8Array([1]),
    })).rejects.toMatchObject({ code: "aborted" });
    mocks.append.mockResolvedValue(false);
    await expect(importImapMessageSource(config as never, {
      mailboxId: id.mailbox(encodeMailboxId("Inbox")), source: new Uint8Array([1]),
    })).rejects.toMatchObject({ code: "provider_failure" });
  });
});
