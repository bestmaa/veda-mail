import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getMessage = vi.fn();
  const mutateMessage = vi.fn();
  return {
    assertRequestRateLimit: vi.fn(),
    assertSubjectRateLimit: vi.fn(),
    connection: { id: "connection-message-routes" },
    getCurrentConnection: vi.fn(),
    getMailService: vi.fn(),
    getMessage,
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
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";

const request = (path: string, init?: RequestInit): Request =>
  new Request(`${origin}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
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
    mutateMessage: mocks.mutateMessage,
  });
  mocks.getMessage.mockReset();
  mocks.mutateMessage.mockReset();
});

describe("mail read and mutation routes", () => {
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

  it.each([
    ["GET", getMessage],
    ["PATCH", patchMessage],
  ] as const)(
    "rejects a stale mailbox scope before the provider on %s",
    async (method, handler) => {
      const routeRequest = request("/api/v1/mail/messages/message-42", {
        ...(method === "PATCH"
          ? {
              body: JSON.stringify({
                type: "set-starred",
                value: true,
              }),
            }
          : {}),
        headers: { "x-veda-mail-session-scope": "stale-session-scope" },
        method,
      });

      const response = await handler(routeRequest, context("message-42"));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "MAIL_SESSION_CHANGED",
          message: "Mailbox session changed. Reload this page and try again.",
        },
      });
      expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
      expect(mocks.getMailService).not.toHaveBeenCalled();
      expect(mocks.getMessage).not.toHaveBeenCalled();
      expect(mocks.mutateMessage).not.toHaveBeenCalled();
    },
  );

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
