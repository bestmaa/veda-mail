import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { downloadImapAttachment } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: vi.fn(),
  connectImapClient: mocks.connect,
}));

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

describe("IMAP attachment message scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects another account's message identifier before connecting", async () => {
    const messageId = id.message(
      encodeScopedImapMessageId(
        { ...config, username: "other@example.com" },
        { mailbox: "INBOX", uid: 77, uidValidity: BigInt(9) },
      ),
    );

    await expect(
      downloadImapAttachment(config, {
        attachmentId: id.attachment("opaque-attachment"),
        maxBytes: 16,
        messageId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
