import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { createdAt: "2026-08-02T10:00:00.000Z", id: "mailbox-search" },
  getWorkspace: vi.fn(),
  listMailboxes: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: async () => mocks.connection,
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: { isActiveAsync: () => true },
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: async () => ({
    getAccount: async () => ({
      email: "member@example.com", providerId: "provider-1",
    }),
    getWorkspace: mocks.getWorkspace,
    listMailboxes: mocks.listMailboxes,
  }),
}));
vi.mock("@/server/mail/message-list-cursor", () => ({
  messageListCursorSecret: async () => "cursor-secret",
}));
vi.mock("@/server/preferences/message-list-preferences.store", () => ({
  messageListPreferencesStore: { get: async () => ({
    density: "comfortable", showPreview: true, sort: "newest",
  }) },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
}));

import { GET } from "@/app/api/v1/mail/workspace/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const inbox = {
  color: "#4f46e5", id: "inbox-1", name: "Inbox", parentId: null,
  rights: { mayCreateChild: false, mayDelete: false, mayRename: false },
  role: "inbox", sortOrder: 0, total: 0, unread: 0,
} as const;
const request = (search: string) => new Request(
  `https://mail.example.com/api/v1/mail/workspace?search=${encodeURIComponent(search)}`,
  { headers: {
    origin: "https://mail.example.com",
    "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
  } },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listMailboxes.mockResolvedValue([inbox]);
  mocks.getWorkspace.mockResolvedValue({
    account: { email: "member@example.com", id: "account-1",
      name: "Member", providerId: "provider-1" },
    mailboxes: [inbox], messages: { items: [], nextCursor: null, total: 0 },
  });
});

describe("mail workspace mailbox search route", () => {
  it("resolves in: scope before calling the provider", async () => {
    const response = await GET(request("in:inbox from:ada@example.com"));

    expect(response.status).toBe(200);
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      includePreview: true, limit: 50, mailboxId: "inbox-1",
      search: {
        canonical: "from:ada@example.com",
        criteria: [{ field: "from", type: "text", value: "ada@example.com" }],
      },
      sort: "newest",
    }, [inbox]);
    await expect(response.json()).resolves.toMatchObject({
      data: { selectedMailboxId: "inbox-1" },
    });
  });

  it("fails before provider message access for an unknown mailbox", async () => {
    const response = await GET(request("in:missing is:unread"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_MAIL_SEARCH" },
    });
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });
});
