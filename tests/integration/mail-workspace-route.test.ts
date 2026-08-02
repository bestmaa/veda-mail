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
  getAccount: vi.fn(),
  getMailService: vi.fn(),
  listMailboxes: vi.fn(),
  getWorkspace: vi.fn(),
  cursorSecret: vi.fn(),
  decodeCursor: vi.fn(),
  encodeCursor: vi.fn(),
  preferencesGet: vi.fn(),
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

vi.mock("@/server/mail/message-list-cursor", () => ({
  decodeMessageListCursor: mocks.decodeCursor,
  encodeMessageListCursor: mocks.encodeCursor,
  messageListCursorSecret: mocks.cursorSecret,
}));

vi.mock("@/server/preferences/message-list-preferences.store", () => ({
  messageListPreferencesStore: { get: mocks.preferencesGet },
}));

vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET as getWorkspace } from "@/app/api/v1/mail/workspace/route";
import { MailSearchUnsupportedError } from "@/domain/mail/mail-search";
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
    getAccount: mocks.getAccount,
    getWorkspace: mocks.getWorkspace,
    listMailboxes: mocks.listMailboxes,
  });
  mocks.getAccount.mockReset();
  mocks.getAccount.mockResolvedValue({
    email: "member@example.com",
    providerId: "provider-1",
  });
  mocks.getWorkspace.mockReset();
  mocks.listMailboxes.mockReset();
  mocks.cursorSecret.mockReset();
  mocks.cursorSecret.mockResolvedValue("cursor-secret");
  mocks.decodeCursor.mockReset();
  mocks.decodeCursor.mockReturnValue("50");
  mocks.encodeCursor.mockReset();
  mocks.encodeCursor.mockReturnValue("next-opaque-cursor");
  mocks.preferencesGet.mockReset();
  mocks.preferencesGet.mockResolvedValue({
    density: "comfortable", showPreview: true, sort: "newest",
  });
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
      "/api/v1/mail/workspace?mailboxId=inbox-1&cursor=opaque&search=quarterly&sort=newest&preview=show",
    );

    const response = await getWorkspace(routeRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        ...workspace,
        labelDeletions: [],
        labels: [],
        mailboxEmptyOperations: [],
        messageListPreferences: {
          density: "comfortable", showPreview: true, sort: "newest",
        },
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
      cursor: "50",
      includePreview: true,
      limit: 50,
      mailboxId: "inbox-1",
      search: {
        canonical: "quarterly",
        criteria: [{ field: "text", type: "text", value: "quarterly" }],
      },
      sort: "newest",
    });
    expect(mocks.decodeCursor).toHaveBeenCalledWith(
      "opaque",
      {
        includePreview: true,
        mailboxId: "inbox-1",
        search: "quarterly",
        sort: "newest",
      },
      "cursor-secret",
    );
    expect(mocks.connectionIsActive).toHaveBeenCalledWith(mocks.connection);
  });

  it.each([
    "cursor=opaque",
    "cursor=",
    "mailboxId=",
    "preview=",
    "sort=sender",
    "sort=",
    "preview=maybe",
    "sort=newest&sort=oldest",
    "unknown=value",
  ])(
    "rejects the invalid mailbox query %s before calling the provider",
    async (query) => {
      const response = await getWorkspace(request(`/api/v1/mail/workspace?${query}`));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: expect.any(String) },
      });
      expect(mocks.getMailService).not.toHaveBeenCalled();
      expect(mocks.getWorkspace).not.toHaveBeenCalled();
    },
  );

  it("reports a provider-unsupported predicate without widening the search", async () => {
    mocks.getWorkspace.mockRejectedValueOnce(
      new MailSearchUnsupportedError(["has:attachment"]),
    );

    const response = await getWorkspace(request(
      "/api/v1/mail/workspace?search=has%3Aattachment",
    ));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MAIL_SEARCH_UNSUPPORTED",
        message: "This provider does not support has:attachment search.",
      },
    });
  });

  it("does not return mailbox data after the connection expires in flight", async () => {
    mocks.getWorkspace.mockResolvedValue({
      account: {},
      mailboxes: [{ id: "inbox-1", role: "inbox" }],
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
