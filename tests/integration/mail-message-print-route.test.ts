import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  createDocument: vi.fn(),
  getCurrentConnection: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/message-print", () => ({
  createConnectionMessagePrintDocument: mocks.createDocument,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { POST } from "@/app/api/v1/mail/messages/[messageId]/print/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = { id: "print-connection" };
const context = (messageId: string) => ({ params: Promise.resolve({ messageId }) });
const request = (body: unknown, options: {
  readonly origin?: string;
  readonly scope?: string;
} = {}) => new Request(`${origin}/api/v1/mail/messages/anchor/print`, {
  body: JSON.stringify(body),
  headers: {
    "content-type": "application/json",
    host: "mail.example.com",
    origin: options.origin ?? origin,
    "x-veda-mail-session-scope": options.scope ?? mailSessionScope(connection),
  },
  method: "POST",
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.createDocument.mockResolvedValue({
    anchorMessageId: "anchor",
    messages: [],
    scope: "conversation",
    total: 0,
    truncated: false,
  });
});

describe("message print route", () => {
  it("requires session scope and returns a private provider-neutral document", async () => {
    const routeRequest = request({ scope: "conversation" });
    const response = await POST(routeRequest, context("anchor"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.createDocument).toHaveBeenCalledWith(
      connection,
      "anchor",
      "conversation",
    );
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest, "mail-print", 500, 10, 60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-print", connection.id, 4, 60_000,
    );
  });

  it("rejects stale sessions, cross-origin posts, mass assignment, and invalid ids", async () => {
    expect((await POST(
      request({ scope: "message" }, { scope: "stale" }),
      context("anchor"),
    )).status).toBe(409);
    expect((await POST(
      request({ scope: "message" }, { origin: "https://attacker.example" }),
      context("anchor"),
    )).status).toBe(403);
    expect((await POST(
      request({ owner: "victim", scope: "message" }),
      context("anchor"),
    )).status).toBe(400);
    expect((await POST(request({ scope: "message" }), context(""))).status).toBe(400);
  });

  it("bounds the body before provider access", async () => {
    const response = await POST(
      request({ scope: "message", padding: "x".repeat(2_000) }),
      context("anchor"),
    );
    expect(response.status).toBe(413);
    expect(mocks.createDocument).not.toHaveBeenCalled();
  });
});
