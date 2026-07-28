import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getMessage = vi.fn();
  const getWorkspace = vi.fn();
  const mutateMessage = vi.fn();
  return {
    assertRequestRateLimit: vi.fn(),
    assertSubjectRateLimit: vi.fn(),
    connection: { id: "connection-message-routes" },
    getCurrentConnection: vi.fn(),
    getMailService: vi.fn(),
    getMessage,
    getWorkspace,
    mutateMessage,
  };
});

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

import {
  GET as getMessage,
  PATCH as patchMessage,
} from "@/app/api/v1/mail/messages/[messageId]/route";
import { GET as getWorkspace } from "@/app/api/v1/mail/workspace/route";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";

const request = (path: string, init?: RequestInit): Request =>
  new Request(`${origin}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      ...init?.headers,
    },
  });

const context = (messageId: string) => ({
  params: Promise.resolve({ messageId }),
});

beforeEach(() => {
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockReset();
  mocks.getMailService.mockResolvedValue({
    getMessage: mocks.getMessage,
    getWorkspace: mocks.getWorkspace,
    mutateMessage: mocks.mutateMessage,
  });
  mocks.getMessage.mockReset();
  mocks.getWorkspace.mockReset();
  mocks.mutateMessage.mockReset();
});

describe("mail read and mutation routes", () => {
  it("loads a filtered workspace through the authenticated mail service", async () => {
    const workspace = {
      account: {
        email: "member@example.com",
        id: "account-1",
        name: "Member",
        providerId: "provider-1",
      },
      mailboxes: [],
      messages: { items: [], nextCursor: null, total: 0 },
    };
    mocks.getWorkspace.mockResolvedValue(workspace);
    const routeRequest = request(
      "/api/v1/mail/workspace?mailboxId=inbox-1&cursor=cursor-2&search=quarterly",
    );

    const response = await getWorkspace(routeRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ data: workspace });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-read",
      20_000,
      1_000,
      60 * 1_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-read",
      mocks.connection.id,
      300,
      60 * 1_000,
    );
    expect(mocks.getMailService).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      cursor: "cursor-2",
      limit: 50,
      mailboxId: "inbox-1",
      search: "quarterly",
    });
  });

  it("loads one message by its route identifier", async () => {
    const message = {
      attachments: [],
      cc: [],
      from: [{ email: "sender@example.com", name: "Sender" }],
      hasAttachment: false,
      htmlBody: null,
      id: "message-42",
      isStarred: false,
      isUnread: true,
      mailboxIds: ["inbox-1"],
      preview: "Hello",
      receivedAt: "2026-07-29T00:00:00.000Z",
      replyTo: [],
      size: 5,
      subject: "A message",
      textBody: "Hello",
      threadId: "thread-1",
      to: [{ email: "member@example.com", name: "Member" }],
    };
    mocks.getMessage.mockResolvedValue(message);
    const routeRequest = request("/api/v1/mail/messages/message-42");

    const response = await getMessage(routeRequest, context("message-42"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: message });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-read",
      20_000,
      1_000,
      60 * 1_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-read",
      mocks.connection.id,
      300,
      60 * 1_000,
    );
    expect(mocks.getMailService).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.getMessage).toHaveBeenCalledWith("message-42");
  });

  it("validates and forwards a message mutation", async () => {
    const routeRequest = request("/api/v1/mail/messages/message-42", {
      body: JSON.stringify({ type: "set-starred", value: true }),
      method: "PATCH",
    });

    const response = await patchMessage(
      routeRequest,
      context("message-42"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { updated: true },
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-mutation",
      5_000,
      300,
      60 * 1_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-mutation",
      mocks.connection.id,
      120,
      60 * 1_000,
    );
    expect(mocks.getMailService).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.mutateMessage).toHaveBeenCalledWith({
      messageId: "message-42",
      type: "set-starred",
      value: true,
    });
  });

  it("returns an authenticated subject rate limit before provider lookup", async () => {
    mocks.assertSubjectRateLimit.mockImplementationOnce(() => {
      throw new ApiError(
        "Too many requests. Please wait and try again.",
        "RATE_LIMITED",
        429,
      );
    });
    const routeRequest = request("/api/v1/mail/messages/message-42");

    const response = await getMessage(routeRequest, context("message-42"));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait and try again.",
      },
    });
    expect(mocks.getCurrentConnection).toHaveBeenCalledOnce();
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-read",
      mocks.connection.id,
      300,
      60 * 1_000,
    );
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.getMessage).not.toHaveBeenCalled();
  });
});
