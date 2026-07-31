import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connectionIsActive: vi.fn(),
  connection: {
    createdAt: "2026-07-31T10:00:00.000Z",
    id: "connection-workspace-route",
  },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));

vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: { isActive: mocks.connectionIsActive },
}));

vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));

vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET as getWorkspace } from "@/app/api/v1/mail/workspace/route";
import { connectionExpiresAt } from "@/server/connections/connection-lifetime";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (path: string): Request =>
  new Request(`${origin}${path}`, {
    headers: {
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
    },
  });

beforeEach(() => {
  mocks.assertRequestRateLimit.mockReset();
  mocks.assertSubjectRateLimit.mockReset();
  mocks.connectionIsActive.mockReset();
  mocks.connectionIsActive.mockReturnValue(true);
  mocks.getCurrentConnection.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockReset();
  mocks.getMailService.mockResolvedValue({
    getWorkspace: mocks.getWorkspace,
  });
  mocks.getWorkspace.mockReset();
});

describe("mail workspace route", () => {
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
    await expect(response.json()).resolves.toEqual({
      data: {
        ...workspace,
        sessionExpiresAt: connectionExpiresAt(mocks.connection),
        sessionScope: mailSessionScope(mocks.connection),
      },
    });
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
    expect(mocks.connectionIsActive).toHaveBeenCalledWith(mocks.connection);
  });

  it("does not return mailbox data after the connection expires in flight", async () => {
    mocks.getWorkspace.mockResolvedValue({
      account: {},
      mailboxes: [],
      messages: { items: [], nextCursor: null, total: 0 },
    });
    mocks.connectionIsActive.mockReturnValue(false);

    const response = await getWorkspace(request("/api/v1/mail/workspace"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEMBER_SESSION_EXPIRED",
        message: "This mail connection expired. Connect the account again.",
      },
    });
  });
});
