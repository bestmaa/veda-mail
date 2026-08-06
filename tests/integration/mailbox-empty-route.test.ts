import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";

const mocks = vi.hoisted(() => ({
  connection: { id: "connection-empty" },
  emptyMailboxBatch: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mailboxes/mailbox-empty.service", () => ({
  emptyMailboxBatch: mocks.emptyMailboxBatch,
}));
vi.mock("@/server/mailboxes/mailbox-http", () => ({
  mailboxOwner: vi.fn().mockResolvedValue({
    email: "member@example.com",
    providerId: "stalwart",
  }),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/security-audit/security-audit", () => ({ appendSecurityAudit: vi.fn(), auditTargetId: vi.fn(() => "target"), memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })) }));

import { POST } from "@/app/api/v1/mail/mailboxes/empty/route";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mailboxId = id.mailbox("trash-a");
const origin = "https://mail.example.com";
const request = (body: unknown, scope = mailSessionScope(mocks.connection)) =>
  new Request(`${origin}/api/v1/mail/mailboxes/empty`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      host: "mail.example.com",
      origin,
      "x-veda-mail-session-scope": scope,
    },
    method: "POST",
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({});
  mocks.emptyMailboxBatch.mockResolvedValue({
    complete: false,
    processed: 0,
    removed: 0,
  });
});

describe("mailbox empty route", () => {
  it("starts one server-owned resumable batch", async () => {
    const response = await POST(request({ mailboxId }));

    expect(response.status).toBe(202);
    expect(mocks.emptyMailboxBatch).toHaveBeenCalledWith(
      {},
      { email: "member@example.com", providerId: "stalwart" },
      mailboxId,
    );
    await expect(response.json()).resolves.toEqual({ data: {
      complete: false,
      processed: 0,
      removed: 0,
    } });
  });

  it("rejects stale scope and unknown request fields", async () => {
    const stale = await POST(request({ mailboxId }, "stale"));
    const unknown = await POST(request({ mailboxId, cursor: "client-owned" }));

    expect(stale.status).toBe(409);
    expect(unknown.status).toBe(400);
    expect(mocks.emptyMailboxBatch).not.toHaveBeenCalled();
  });

  it("redacts unexpected provider errors", async () => {
    mocks.emptyMailboxBatch.mockRejectedValueOnce(
      new Error("unexpected provider detail"),
    );

    const response = await POST(request({ mailboxId }));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toContain("Unable to empty this mailbox.");
    expect(body).not.toContain("provider detail");
  });
});
