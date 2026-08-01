import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mailbox } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  appearanceRemove: vi.fn(),
  appearanceSet: vi.fn(),
  connection: { id: "connection-mailboxes" },
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  listMailboxes: vi.fn(),
  mutateMailbox: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/mailboxes/mailbox-appearance.store", () => ({
  mailboxAppearanceStore: {
    remove: mocks.appearanceRemove,
    set: mocks.appearanceSet,
  },
}));
vi.mock("@/server/mailboxes/mailbox-http", () => ({
  decorateMailboxesSafely: async (_owner: unknown, mailboxes: unknown) => mailboxes,
  mailboxHttpError: (error: unknown) => error,
  mailboxOwner: async () => ({ email: "member@example.com", providerId: "mock" }),
}));

import { DELETE, PATCH, POST } from "@/app/api/v1/mail/mailboxes/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const request = (
  method: "DELETE" | "PATCH" | "POST",
  body: unknown,
  scope = mailSessionScope(mocks.connection),
) => new Request(`${origin}/api/v1/mail/mailboxes`, {
  body: JSON.stringify(body),
  headers: {
    "content-type": "application/json",
    host: "mail.example.com",
    origin,
    "x-veda-mail-session-scope": scope,
  },
  method,
});

const customMailbox = (value: string): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name: "Projects",
  parentId: null,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  role: "custom",
  sortOrder: 0,
  total: 0,
  unread: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    listMailboxes: mocks.listMailboxes,
    mutateMailbox: mocks.mutateMailbox,
  });
  mocks.appearanceRemove.mockResolvedValue(undefined);
  mocks.appearanceSet.mockResolvedValue(undefined);
});

describe("mailbox management routes", () => {
  it("creates a mailbox and persists its account-scoped color", async () => {
    const created = customMailbox("created");
    mocks.mutateMailbox.mockResolvedValue({
      mailboxId: created.id,
      mailboxes: [created],
    });
    const response = await POST(request("POST", {
      color: "#a855f7",
      name: "Projects",
      parentId: null,
    }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { appearanceSaved: true, mailboxId: created.id },
    });
    expect(mocks.mutateMailbox).toHaveBeenCalledWith({
      name: "Projects", parentId: null, type: "create",
    });
    expect(mocks.appearanceSet).toHaveBeenCalledWith(
      expect.any(Object), created.id, "#a855f7", undefined,
    );
  });

  it("supports a color-only update without touching the provider hierarchy", async () => {
    const mailbox = customMailbox("folder");
    mocks.listMailboxes.mockResolvedValue([mailbox]);
    const response = await PATCH(request("PATCH", {
      color: "#ec4899",
      mailboxId: mailbox.id,
    }));
    expect(response.status).toBe(200);
    expect(mocks.mutateMailbox).not.toHaveBeenCalled();
    expect(mocks.appearanceSet).toHaveBeenCalledWith(
      expect.any(Object), mailbox.id, "#ec4899",
    );
  });

  it("cleans appearance metadata only after provider deletion succeeds", async () => {
    const mailbox = customMailbox("folder");
    mocks.mutateMailbox.mockResolvedValue({ mailboxId: null, mailboxes: [] });
    const response = await DELETE(request("DELETE", { mailboxId: mailbox.id }));
    expect(response.status).toBe(200);
    expect(mocks.mutateMailbox).toHaveBeenCalledWith({
      mailboxId: mailbox.id, type: "delete",
    });
    expect(mocks.appearanceRemove).toHaveBeenCalledWith(
      expect.any(Object), mailbox.id,
    );
  });

  it("rejects a stale browser scope before provider access", async () => {
    const response = await POST(request("POST", {
      color: "#64748b", name: "Projects", parentId: null,
    }, "stale"));
    expect(response.status).toBe(409);
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });
});
