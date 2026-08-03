import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "conversation-connection" },
  cursorSecret: vi.fn(),
  decodeCursor: vi.fn(),
  encodeCursor: vi.fn(),
  getConversation: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mail/conversation-cursor", () => ({
  conversationCursorSecret: mocks.cursorSecret,
  decodeConversationCursor: mocks.decodeCursor,
  encodeConversationCursor: mocks.encodeCursor,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/conversation/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (path: string, scope = mailSessionScope(mocks.connection)) =>
  new Request(`${origin}${path}`, {
    headers: {
      host: "mail.example.com",
      "x-veda-mail-session-scope": scope,
    },
  });
const context = (messageId: string) => ({
  params: Promise.resolve({ messageId }),
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  }
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    getConversation: mocks.getConversation,
  });
  mocks.cursorSecret.mockResolvedValue("connection-secret");
  mocks.decodeCursor.mockReturnValue(`25.${"s".repeat(43)}`);
  mocks.encodeCursor.mockReturnValue("public-next-cursor");
  mocks.getConversation.mockResolvedValue({
    anchorMessageId: "anchor",
    items: [],
    nextCursor: `50.${"s".repeat(43)}`,
    strategy: "native",
    total: 51,
    truncated: false,
  });
});

describe("conversation route", () => {
  it("loads a fixed provider page and wraps its next cursor", async () => {
    const routeRequest = request(
      "/api/v1/mail/messages/anchor/conversation?cursor=public-cursor",
    );

    const response = await GET(routeRequest, context("anchor"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        anchorMessageId: "anchor",
        items: [],
        nextCursor: "public-next-cursor",
        strategy: "native",
        total: 51,
        truncated: false,
      },
    });
    expect(mocks.decodeCursor).toHaveBeenCalledWith(
      "public-cursor",
      "anchor",
      "connection-secret",
    );
    expect(mocks.getConversation).toHaveBeenCalledWith({
      anchorMessageId: "anchor",
      cursor: `25.${"s".repeat(43)}`,
      limit: 25,
    });
    expect(mocks.encodeCursor).toHaveBeenCalledWith(
      `50.${"s".repeat(43)}`,
      "anchor",
      "connection-secret",
    );
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "mail-conversation",
      2_000,
      120,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "mail-conversation",
      mocks.connection.id,
      30,
      60_000,
    );
  });

  it("rejects a stale session scope before cursor or provider work", async () => {
    const response = await GET(
      request("/api/v1/mail/messages/anchor/conversation", "stale-scope"),
      context("anchor"),
    );

    expect(response.status).toBe(409);
    expect(mocks.assertSubjectRateLimit).not.toHaveBeenCalled();
    expect(mocks.cursorSecret).not.toHaveBeenCalled();
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it.each([
    ["", "/api/v1/mail/messages/x/conversation"],
    ["x".repeat(2_049), "/api/v1/mail/messages/x/conversation"],
    ["anchor", "/api/v1/mail/messages/anchor/conversation?cursor="],
    ["anchor", "/api/v1/mail/messages/anchor/conversation?cursor=a&cursor=b"],
    ["anchor", "/api/v1/mail/messages/anchor/conversation?thread=provider-id"],
  ])("rejects invalid route/query input before provider access", async (
    messageId,
    path,
  ) => {
    const response = await GET(request(path), context(messageId));

    expect(response.status).toBe(400);
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.getConversation).not.toHaveBeenCalled();
  });

  it("returns a null public cursor when the provider has no next page", async () => {
    mocks.getConversation.mockResolvedValueOnce({
      anchorMessageId: "anchor",
      items: [],
      nextCursor: null,
      strategy: "references",
      total: 1,
      truncated: false,
    });

    const response = await GET(
      request("/api/v1/mail/messages/anchor/conversation"),
      context("anchor"),
    );

    expect(response.status).toBe(200);
    expect(mocks.decodeCursor).not.toHaveBeenCalled();
    expect(mocks.encodeCursor).not.toHaveBeenCalled();
    expect(mocks.getConversation).toHaveBeenCalledWith({
      anchorMessageId: "anchor",
      limit: 25,
    });
  });
});
