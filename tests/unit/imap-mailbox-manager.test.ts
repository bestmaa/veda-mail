import type { ImapFlow, ListResponse } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const state = vi.hoisted(() => ({
  client: {
    list: vi.fn(),
    mailboxCreate: vi.fn(),
    mailboxDelete: vi.fn(),
    mailboxRename: vi.fn(),
    mailboxSubscribe: vi.fn(),
    status: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  withImapClient: async (
    _config: ImapSmtpMemberConfig,
    task: (client: ImapFlow) => Promise<unknown>,
  ) => task(state.client as unknown as ImapFlow),
}));

import { ImapMailboxManager } from "@/infrastructure/providers/imap-smtp/imap-mailbox.manager";

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com", imapPort: "993", imapSecurity: "tls",
  secret: "secret", smtpHost: "smtp.example.com", smtpMaxMessageBytes: "1000000",
  smtpPort: "465", smtpSecurity: "tls", username: "member@example.com",
};
const raw = (
  path: string,
  parentPath = "",
  statusMessages = 0,
): ListResponse => ({
  delimiter: "/",
  flags: new Set(),
  listed: true,
  name: path.split("/").at(-1)!,
  parent: parentPath ? parentPath.split("/") : [],
  parentPath,
  path,
  pathAsListed: path,
  status: { messages: statusMessages, path, unseen: 0 },
  subscribed: true,
});

beforeEach(() => vi.clearAllMocks());

describe("IMAP mailbox manager", () => {
  it("creates a subscribed child with the server delimiter", async () => {
    const parent = raw("Projects");
    const child = raw("Projects/Client", "Projects");
    state.client.list.mockResolvedValueOnce([parent]).mockResolvedValueOnce([parent, child]);
    state.client.mailboxCreate.mockResolvedValue({ created: true, path: child.path });
    state.client.mailboxSubscribe.mockResolvedValue(true);
    const result = await new ImapMailboxManager(config).mutate({
      name: "Client",
      parentId: id.mailbox(encodeMailboxId(parent.path)),
      type: "create",
    });
    expect(state.client.mailboxCreate).toHaveBeenCalledWith("Projects/Client");
    expect(state.client.mailboxSubscribe).toHaveBeenCalledWith("Projects/Client");
    expect(result.mailboxId).toBe(encodeMailboxId("Projects/Client"));
  });

  it("rejects delimiter injection before issuing CREATE", async () => {
    state.client.list.mockResolvedValue([raw("INBOX")]);
    await expect(new ImapMailboxManager(config).mutate({
      name: "bad/name", parentId: null, type: "create",
    })).rejects.toMatchObject({ failure: "name" });
    expect(state.client.mailboxCreate).not.toHaveBeenCalled();
  });

  it("rechecks message count immediately before destructive DELETE", async () => {
    const target = raw("Projects", "", 0);
    state.client.list.mockResolvedValue([target]);
    state.client.status.mockResolvedValue({ messages: 1, path: target.path });
    await expect(new ImapMailboxManager(config).mutate({
      mailboxId: id.mailbox(encodeMailboxId(target.path)),
      type: "delete",
    })).rejects.toMatchObject({ failure: "mail-exists" });
    expect(state.client.mailboxDelete).not.toHaveBeenCalled();
  });
});
