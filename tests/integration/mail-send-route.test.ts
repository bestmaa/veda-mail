import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sendMessage = vi.fn(async (input: unknown) => {
    void input;
    return {
      id: "sent-message",
      submittedAt: "2026-07-29T00:00:00.000Z",
    };
  });
  return {
    getCurrentConnection: vi.fn(async () => ({ id: "connection-1" })),
    getMailService: vi.fn(async () => ({ sendMessage })),
    sendMessage,
  };
});

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));

import { POST } from "@/app/api/v1/mail/send/route";
import { ApiError } from "@/transport/http/api-error";

const endpoint = "https://mail.example.com/api/v1/mail/send";

const address = (email: string, name: string | null = null) => ({
  email,
  name,
});

const payload = (overrides: Record<string, unknown> = {}) => ({
  body: "Hello from the route test",
  subject: "Route integration",
  to: [address("recipient@example.com")],
  ...overrides,
});

const request = (
  body: string | Record<string, unknown>,
  headers: Record<string, string> = {},
): Request =>
  new Request(endpoint, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin: "https://mail.example.com",
      ...headers,
    },
    method: "POST",
  });

beforeEach(() => {
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue({ id: "connection-1" });
  mocks.getMailService.mockClear();
  mocks.sendMessage.mockClear();
});

describe("POST /api/v1/mail/send", () => {
  it.each([
    ["CC", { cc: [address("copy@example.com")], to: [] }],
    ["BCC", { bcc: [address("hidden@example.com")], to: [] }],
  ])("sends a %s-only message through the mail service", async (_, lists) => {
    const response = await POST(request(payload(lists)));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: "sent-message",
        submittedAt: "2026-07-29T00:00:00.000Z",
      },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      bcc: "bcc" in lists ? lists.bcc : [],
      body: "Hello from the route test",
      cc: "cc" in lists ? lists.cc : [],
      subject: "Route integration",
      to: [],
    });
  });

  it("passes the reply message identifier through unchanged", async () => {
    const response = await POST(
      request(payload({ inReplyTo: "<provider-message-42@example.com>" })),
    );

    expect(response.status).toBe(201);
    expect(mocks.sendMessage).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      bcc: [],
      body: "Hello from the route test",
      cc: [],
      inReplyTo: "<provider-message-42@example.com>",
      subject: "Route integration",
      to: [address("recipient@example.com")],
    });
  });

  it("rejects the 31st message for one authenticated connection", async () => {
    const connectionId = `mail-send-rate-limit-${crypto.randomUUID()}`;
    mocks.getCurrentConnection.mockResolvedValue({ id: connectionId });

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const response = await POST(request(payload()));
      expect(response.status, `request ${attempt}`).toBe(201);
    }

    const rejected = await POST(request(payload()));

    expect(rejected.status).toBe(429);
    await expect(rejected.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait and try again.",
      },
    });
    expect(mocks.getMailService).toHaveBeenCalledTimes(30);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(30);
  });

  it("returns the deliberate authentication failure without invoking a provider", async () => {
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError(
        "Sign in with your mailbox account.",
        "MEMBER_SESSION_REQUIRED",
        401,
      ),
    );

    const response = await POST(request(payload()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEMBER_SESSION_REQUIRED",
        message: "Sign in with your mailbox account.",
      },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an Origin mismatch",
      { origin: "https://attacker.example" },
    ],
    [
      "cross-site fetch metadata without Origin",
      { origin: "", "sec-fetch-site": "cross-site" },
    ],
  ])("rejects %s before authentication", async (_, headers) => {
    const response = await POST(request(payload(), headers));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST_ORIGIN" },
    });
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("stops an oversized request stream before provider invocation", async () => {
    const response = await POST(
      request(payload({ body: "x".repeat(1024 * 1024) })),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_TOO_LARGE" },
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{not-json"],
    [
      "a subject header injection",
      JSON.stringify(payload({ subject: "Hello\r\nBcc: victim@example.com" })),
    ],
  ])("rejects %s before provider invocation", async (_, body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
