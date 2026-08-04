import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as SnoozeServiceModule from "@/server/snooze/snooze-service";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
  createSnoozes: vi.fn(), getCurrentConnection: vi.fn(),
  readSnoozeWorkspace: vi.fn(), rescheduleSnooze: vi.fn(),
  restoreSnooze: vi.fn(), retrySnooze: vi.fn(),
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/snooze/snooze-service", async (importOriginal) => ({
  ...await importOriginal<typeof SnoozeServiceModule>(),
  createSnoozes: mocks.createSnoozes,
  readSnoozeWorkspace: mocks.readSnoozeWorkspace,
  rescheduleSnooze: mocks.rescheduleSnooze,
  restoreSnooze: mocks.restoreSnooze,
  retrySnooze: mocks.retrySnooze,
}));

import { GET, POST } from "@/app/api/v1/mail/snoozed/route";
import { PATCH } from "@/app/api/v1/mail/snoozed/[snoozeId]/route";
import { POST as RESTORE } from "@/app/api/v1/mail/snoozed/[snoozeId]/restore/route";
import { POST as RETRY } from "@/app/api/v1/mail/snoozed/[snoozeId]/retry/route";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = { config: {}, createdAt: "2026-08-04T00:00:00.000Z",
  displayName: "Mail", id: id.connection("snooze-route"),
  providerId: id.provider("mock") };
const snoozeId = "11111111-1111-4111-8111-111111111111";
const emptyBook = { messages: [], revision: null, snoozedMailboxId: null, version: 1 };
const request = (path: string, method: string, body?: unknown,
  requestOrigin = origin, scope = mailSessionScope(connection)) =>
  new Request(`${origin}${path}`, { method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      host: "mail.example.com", origin: requestOrigin,
      "x-veda-mail-session-scope": scope } });
const context = { params: Promise.resolve({ snoozeId }) };
const item = { messageId: "message-1", sourceMailboxId: "inbox",
  wakeAt: "2026-08-05T00:00:00.000Z" };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.readSnoozeWorkspace.mockResolvedValue({ book: emptyBook,
    capability: { maxMessages: 100, snoozedMailboxId: null, supported: true } });
  mocks.createSnoozes.mockResolvedValue({ book: emptyBook,
    outcomes: [{ errorCode: null, messageId: "message-1", snoozeId,
      status: "accepted" }] });
  mocks.rescheduleSnooze.mockResolvedValue(emptyBook);
  mocks.restoreSnooze.mockResolvedValue(emptyBook);
  mocks.retrySnooze.mockResolvedValue(emptyBook);
});

describe("mail snooze routes", () => {
  it("loads private state and returns 201 or 207 bulk outcomes", async () => {
    const loaded = await GET(request("/api/v1/mail/snoozed", "GET"));
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(request("/api/v1/mail/snoozed", "POST", { items: [item] }))).status)
      .toBe(201);
    mocks.createSnoozes.mockResolvedValueOnce({ book: emptyBook, outcomes: [
      { errorCode: null, messageId: "message-1", snoozeId, status: "accepted" },
      { errorCode: "SNOOZE_CONFLICT", messageId: "message-2", snoozeId: null,
        status: "rejected" },
    ] });
    expect((await POST(request("/api/v1/mail/snoozed", "POST",
      { items: [item, { ...item, messageId: "message-2" }] }))).status).toBe(207);
  });

  it("rejects origin, scope, mass assignment, and oversized bulk", async () => {
    expect((await POST(request("/api/v1/mail/snoozed", "POST", { items: [item] },
      "https://attacker.example"))).status).toBe(403);
    expect((await POST(request("/api/v1/mail/snoozed", "POST", { items: [item] },
      origin, "stale"))).status).toBe(409);
    expect((await POST(request("/api/v1/mail/snoozed", "POST",
      { items: [item], owner: "victim@example.com" }))).status).toBe(400);
    expect((await POST(request("/api/v1/mail/snoozed", "POST",
      { items: Array.from({ length: 101 }, () => item) }))).status).toBe(400);
    expect(mocks.createSnoozes).not.toHaveBeenCalled();
  });

  it("reschedules, restores, and retries only an authenticated opaque ID", async () => {
    const wakeAt = "2026-08-06T00:00:00.000Z";
    expect((await PATCH(request(`/api/v1/mail/snoozed/${snoozeId}`, "PATCH",
      { wakeAt }), context)).status).toBe(200);
    expect(mocks.rescheduleSnooze).toHaveBeenCalledWith(connection, snoozeId, wakeAt);
    expect((await RESTORE(request(`/api/v1/mail/snoozed/${snoozeId}/restore`, "POST"),
      context)).status).toBe(200);
    expect((await RETRY(request(`/api/v1/mail/snoozed/${snoozeId}/retry`, "POST"),
      context)).status).toBe(200);
  });
});
