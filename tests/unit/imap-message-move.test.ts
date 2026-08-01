import type { ImapFlow } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: {
    capabilities: new Map<string, boolean>(),
    fetchOne: vi.fn(),
    list: vi.fn(),
    mailboxOpen: vi.fn(),
    messageMove: vi.fn(),
  },
  withImapClient: vi.fn(),
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: mocks.withImapClient,
}));

import { id } from "@/domain/shared/brand";
import {
  encodeMailboxId,
  encodeScopedImapMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { mutateImapMessage } from "@/infrastructure/providers/imap-smtp/imap-message-mutation";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";
import { ProviderMessageMutationRejectedError } from "@/infrastructure/providers/provider-message-mutation-error";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400", smtpPort: "465", smtpSecurity: "tls",
  username: "member@example.com",
};
const sourceMailboxId = id.mailbox(encodeMailboxId("INBOX"));
const destinationMailboxId = id.mailbox(encodeMailboxId("Archive"));
const messageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "INBOX", uid: 77, uidValidity: BigInt(123),
}));
const mutation = {
  destinationMailboxId,
  messageId,
  sourceMailboxId,
  type: "move" as const,
};

describe("IMAP message move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.capabilities = new Map([["MOVE", true]]);
    mocks.client.mailboxOpen.mockResolvedValue({
      readOnly: false, uidValidity: BigInt(123),
    });
    mocks.client.list.mockResolvedValue([
      { flags: new Set(), path: "INBOX", specialUse: "\\Inbox" },
      { flags: new Set(), path: "Archive", specialUse: "\\Archive" },
    ]);
    mocks.client.fetchOne.mockResolvedValue({ uid: 77 });
    mocks.client.messageMove.mockResolvedValue(true);
    mocks.withImapClient.mockImplementation(
      async (_config: ImapSmtpMemberConfig, task: (client: ImapFlow) => Promise<unknown>) =>
        task(mocks.client as unknown as ImapFlow),
    );
  });

  it("uses native MOVE for the exact scoped UID and canonical destination", async () => {
    await mutateImapMessage(config, mutation);

    expect(mocks.client.fetchOne).toHaveBeenCalledWith(
      77, { uid: true }, { uid: true },
    );
    expect(mocks.client.messageMove).toHaveBeenCalledWith(
      77, "Archive", { uid: true },
    );
  });

  it("refuses an unsafe COPY/EXPUNGE fallback when MOVE is unavailable", async () => {
    mocks.client.capabilities = new Map();

    await expect(mutateImapMessage(config, mutation)).rejects.toThrow(
      "native IMAP MOVE",
    );
    expect(mocks.client.messageMove).not.toHaveBeenCalled();
  });

  it("does not report a false MOVE result as success", async () => {
    mocks.client.messageMove.mockResolvedValue(false);

    await expect(mutateImapMessage(config, mutation)).rejects.toBeInstanceOf(
      ProviderMessageMutationRejectedError,
    );
  });

  it("rejects a source mailbox that differs from the scoped message ID", async () => {
    await expect(mutateImapMessage(config, {
      ...mutation,
      sourceMailboxId: id.mailbox(encodeMailboxId("Other")),
    })).rejects.toThrow("outside the selected source");
    expect(mocks.client.messageMove).not.toHaveBeenCalled();
  });
});
