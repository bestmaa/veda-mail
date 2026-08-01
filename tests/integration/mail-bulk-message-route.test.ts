import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "connection-bulk-message" },
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
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { PATCH } from "@/app/api/v1/mail/messages/bulk/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (body: unknown, scope = mailSessionScope(mocks.connection)) =>
  new Request(`${origin}/api/v1/mail/messages/bulk`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": scope,
    },
    method: "PATCH",
  });

beforeEach(() => {
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockReset();
  mocks.getMailService.mockResolvedValue({
    getMessage: mocks.getMessage,
    listMailboxes: mocks.listMailboxes,
    mutateMessage: mocks.mutateMessage,
  });
  mocks.getMessage.mockReset();
  mocks.listMailboxes.mockReset();
  mocks.mutateMessage.mockReset();
  mocks.mutateMessage.mockResolvedValue(undefined);
});

describe("bulk message mutation route", () => {
  it("validates and forwards a bounded bulk mutation", async () => {
    const routeRequest = request({
      messageIds: ["message-a", "message-b"],
      type: "set-read",
      value: true,
    });

    const response = await PATCH(routeRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        failed: [],
        succeeded: expect.arrayContaining(["message-a", "message-b"]),
      },
    });
    expect(mocks.mutateMessage).toHaveBeenCalledTimes(2);
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      messageId: "message-a",
      type: "set-read",
      value: true,
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-bulk-mutation",
      5_000,
      200,
      60 * 1_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-bulk-mutation",
      mocks.connection.id,
      20,
      60 * 1_000,
    );
  });

  it("reports individual failures without exposing provider errors", async () => {
    mocks.mutateMessage.mockImplementation(async (mutation) => {
      if (mutation.messageId === "message-b") {
        throw new Error("provider host secret");
      }
    });

    const response = await PATCH(request({
      messageIds: ["message-a", "message-b"],
      type: "archive",
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      data: { failed: ["message-b"], succeeded: ["message-a"] },
    });
    expect(JSON.stringify(body)).not.toContain("provider host secret");
  });

  it.each([
    {
      messageIds: ["message-a", "message-a"],
      type: "delete",
    },
    {
      messageIds: Array.from({ length: 101 }, (_, index) => `message-${index}`),
      type: "delete",
    },
    {
      extra: true,
      messageIds: ["message-a"],
      type: "delete",
    },
  ])("rejects malformed or unbounded batches before the provider", async (body) => {
    const response = await PATCH(request(body));

    expect(response.status).toBe(400);
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.mutateMessage).not.toHaveBeenCalled();
  });

  it("rejects a stale mailbox scope before parsing or provider lookup", async () => {
    const response = await PATCH(request({
      messageIds: ["message-a"],
      type: "delete",
    }, "stale-scope"));

    expect(response.status).toBe(409);
    expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it("never runs more than four provider mutations concurrently", async () => {
    let active = 0;
    let peak = 0;
    mocks.mutateMessage.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
    });
    const messageIds = Array.from(
      { length: 12 },
      (_, index) => `message-${index}`,
    );

    const response = await PATCH(request({ messageIds, type: "archive" }));

    expect(response.status).toBe(200);
    expect(peak).toBe(4);
  });

  it("rejects permanent deletion outside Spam or Trash", async () => {
    mocks.listMailboxes.mockResolvedValue([
      { id: "inbox-a", name: "Inbox", role: "inbox" },
    ]);

    const response = await PATCH(request({
      mailboxId: "inbox-a",
      messageIds: ["message-a"],
      type: "destroy",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PERMANENT_DELETE_FORBIDDEN",
        message: "Permanent deletion is allowed only from Spam or Trash.",
      },
    });
    expect(mocks.getMessage).not.toHaveBeenCalled();
    expect(mocks.mutateMessage).not.toHaveBeenCalled();
  });

  it("destroys only messages still in the confirmed Trash mailbox", async () => {
    mocks.listMailboxes.mockResolvedValue([
      { id: "trash-a", name: "Trash", role: "trash" },
    ]);
    mocks.getMessage.mockImplementation(async (messageId) => ({
      id: messageId,
      mailboxIds: messageId === "message-a" ? ["trash-a"] : ["inbox-a"],
    }));

    const response = await PATCH(request({
      mailboxId: "trash-a",
      messageIds: ["message-a", "message-b"],
      type: "destroy",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { failed: ["message-b"], succeeded: ["message-a"] },
    });
    expect(mocks.mutateMessage).toHaveBeenCalledOnce();
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      mailboxId: "trash-a",
      messageId: "message-a",
      type: "destroy",
    });
  });
});
