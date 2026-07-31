import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "connection-workspace-route" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  getWorkspace: vi.fn(),
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

import { GET as getWorkspace } from "@/app/api/v1/mail/workspace/route";
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
  });
});
