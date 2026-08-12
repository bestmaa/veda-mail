import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: { createdAt: "2026-08-01T00:00:00.000Z", id: "workspace-prefs" },
  decodeCursor: vi.fn(),
  encodeCursor: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  getWorkspace: vi.fn(),
  preferencesGet: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/connections/connection-store", () => ({
  connectionStore: { isActiveAsync: () => true },
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mail/message-list-cursor", () => ({
  decodeMessageListCursor: mocks.decodeCursor,
  encodeMessageListCursor: mocks.encodeCursor,
  messageListCursorSecret: () => Promise.resolve("cursor-secret"),
}));
vi.mock("@/server/mailboxes/mailbox-http", () => ({
  decorateMailboxesSafely: async (_owner: unknown, mailboxes: unknown) => mailboxes,
  mailboxOwner: async () => ({
    email: "member@example.com",
    providerId: "provider-1",
  }),
}));
vi.mock("@/server/preferences/message-list-preferences.store", () => ({
  messageListPreferencesStore: { get: mocks.preferencesGet },
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/labels/label-catalog.store", () => ({
  labelCatalogStore: { list: () => Promise.resolve([]) },
}));
vi.mock("@/server/labels/label-deletion-catalog.store", () => ({
  labelDeletionCatalogStore: { list: () => Promise.resolve([]) },
}));
vi.mock("@/server/mailboxes/mailbox-empty-operation.store", () => ({
  mailboxEmptyOperationStore: { list: () => Promise.resolve([]) },
}));

import { GET } from "@/app/api/v1/mail/workspace/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const origin = "https://mail.example.com";
const request = (query = ""): Request => new Request(
  `${origin}/api/v1/mail/workspace${query}`,
  { headers: { "x-veda-mail-session-scope": mailSessionScope(mocks.connection) } },
);
const workspace = (nextCursor: string | null = null) => ({
  account: {
    email: "member@example.com",
    id: "account-1",
    name: "Member",
    providerId: "provider-1",
  },
  mailboxes: [{ id: "inbox-1", role: "inbox" }],
  messages: { items: [], nextCursor, total: nextCursor ? 75 : 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({ getWorkspace: mocks.getWorkspace });
  mocks.getWorkspace.mockResolvedValue(workspace());
  mocks.preferencesGet.mockResolvedValue({
    density: "comfortable",
    showPreview: true,
    sort: "newest",
  });
  mocks.decodeCursor.mockReturnValue("50");
  mocks.encodeCursor.mockReturnValue("next-opaque-cursor");
});

describe("workspace preference and cursor contract", () => {
  it.each(["sort=oldest", "preview=hide"])(
    "rejects stale persisted query preference %s before listing messages",
    async (query) => {
      const response = await GET(request(`?${query}`));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "MESSAGE_LIST_PREFERENCES_CHANGED" },
      });
      expect(mocks.getWorkspace).not.toHaveBeenCalled();
    },
  );

  it("fails closed when an opaque cursor is expired or context-invalid", async () => {
    mocks.decodeCursor.mockImplementationOnce(() => {
      throw new ApiError(
        "This mailbox page expired. Refresh the mailbox and try again.",
        "MESSAGE_LIST_CURSOR_EXPIRED",
        409,
      );
    });

    const response = await GET(request(
      "?mailboxId=inbox-1&cursor=expired&sort=newest&preview=show",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MESSAGE_LIST_CURSOR_EXPIRED" },
    });
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });

  it("wraps the provider next position in the exact active context", async () => {
    mocks.getWorkspace.mockResolvedValue(workspace("50"));

    const response = await GET(request(
      "?search=quarterly&sort=newest&preview=show",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { messages: { nextCursor: "next-opaque-cursor", total: 75 } },
    });
    expect(mocks.encodeCursor).toHaveBeenCalledWith("50", {
      includePreview: true,
      mailboxId: "inbox-1",
      search: "quarterly",
      sort: "newest",
    }, "cursor-secret");
  });

  it("uses canonical safe defaults when preference persistence is unavailable", async () => {
    mocks.preferencesGet.mockRejectedValueOnce(new Error("private store path"));

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { messageListPreferences: {
        density: "comfortable",
        showPreview: true,
        sort: "newest",
      } },
    });
    expect(mocks.getWorkspace).toHaveBeenCalledWith({
      includePreview: true,
      limit: 50,
      sort: "newest",
    });
  });
});
