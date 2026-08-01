import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { id: "connection-message-move" },
  getCurrentConnection: vi.fn(),
  getMessage: vi.fn(),
  getMailService: vi.fn(),
  listMailboxes: vi.fn(),
  mutateMessage: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));

import { PATCH as PATCH_BULK } from "@/app/api/v1/mail/messages/bulk/route";
import { PATCH as PATCH_SINGLE } from "@/app/api/v1/mail/messages/[messageId]/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (body: unknown) => new Request(
  `${origin}/api/v1/mail/messages/bulk`,
  {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
    },
    method: "PATCH",
  },
);
const singleRequest = (body: unknown) => new Request(
  `${origin}/api/v1/mail/messages/message-a`,
  {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
    },
    method: "PATCH",
  },
);
const source = {
  id: "inbox-a", role: "inbox", rights: { mayRemoveItems: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    getMessage: mocks.getMessage,
    listMailboxes: mocks.listMailboxes,
    mutateMessage: mocks.mutateMessage,
  });
  mocks.mutateMessage.mockResolvedValue(undefined);
});

describe("message move route", () => {
  it("authorizes and forwards an exact source-to-destination move", async () => {
    mocks.listMailboxes.mockResolvedValue([
      source,
      { id: "custom-a", role: "custom", rights: { mayAddItems: true } },
    ]);
    mocks.getMessage.mockResolvedValue({
      id: "message-a", mailboxIds: ["inbox-a"],
    });

    const response = await PATCH_BULK(request({
      destinationMailboxId: "custom-a",
      messageIds: ["message-a"],
      sourceMailboxId: "inbox-a",
      type: "move",
    }));

    expect(response.status).toBe(200);
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      destinationMailboxId: "custom-a",
      messageId: "message-a",
      sourceMailboxId: "inbox-a",
      type: "move",
    });
  });

  it.each([
    { id: "sent-a", role: "sent", rights: { mayAddItems: true } },
    { id: "custom-a", role: "custom", rights: { mayAddItems: false } },
  ])("rejects a forbidden destination before reading messages", async (destination) => {
    mocks.listMailboxes.mockResolvedValue([source, destination]);

    const response = await PATCH_BULK(request({
      destinationMailboxId: destination.id,
      messageIds: ["message-a"],
      sourceMailboxId: "inbox-a",
      type: "move",
    }));

    expect(response.status).toBe(403);
    expect(mocks.getMessage).not.toHaveBeenCalled();
    expect(mocks.mutateMessage).not.toHaveBeenCalled();
  });

  it("reports stale source membership as a per-message failure", async () => {
    mocks.listMailboxes.mockResolvedValue([
      source,
      { id: "custom-a", role: "custom", rights: { mayAddItems: true } },
    ]);
    mocks.getMessage.mockResolvedValue({
      id: "message-a", mailboxIds: ["archive-a"],
    });

    const response = await PATCH_BULK(request({
      destinationMailboxId: "custom-a",
      messageIds: ["message-a"],
      sourceMailboxId: "inbox-a",
      type: "move",
    }));

    await expect(response.json()).resolves.toEqual({
      data: { failed: ["message-a"], succeeded: [] },
    });
    expect(mocks.mutateMessage).not.toHaveBeenCalled();
  });

  it("applies the same authoritative policy to a single-message move", async () => {
    mocks.listMailboxes.mockResolvedValue([
      source,
      { id: "custom-a", role: "custom", rights: { mayAddItems: true } },
    ]);
    mocks.getMessage.mockResolvedValue({
      id: "message-a", mailboxIds: ["inbox-a"],
    });

    const response = await PATCH_SINGLE(singleRequest({
      destinationMailboxId: "custom-a",
      messageId: "attacker-overridden-id",
      sourceMailboxId: "inbox-a",
      type: "move",
    }), { params: Promise.resolve({ messageId: "message-a" }) });

    expect(response.status).toBe(200);
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      destinationMailboxId: "custom-a",
      messageId: "message-a",
      sourceMailboxId: "inbox-a",
      type: "move",
    });
  });
});
