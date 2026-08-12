import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSecurityAudit: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  getCurrentConnection: vi.fn(),
  importMessageSource: vi.fn(),
  listMailboxes: vi.fn(),
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: vi.fn(async () => ({
    importMessageSource: mocks.importMessageSource,
    listMailboxes: mocks.listMailboxes,
  })),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
vi.mock("@/server/security-audit/security-audit", () => ({
  appendSecurityAudit: mocks.appendSecurityAudit,
  memberAuditActor: vi.fn(() => ({ actorId: "audit", actorType: "member" })),
}));

import { POST } from "@/app/api/v1/mail/messages/import/route";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: "2026-08-12T00:00:00.000Z", displayName: "Mail",
  id: id.connection("message-import-connection"), providerId: id.provider("mock"),
};
const inboxId = id.mailbox("inbox");
const source = new TextEncoder().encode("From: a@example.com\r\n\r\nHello\r\n");
const request = (input: {
  readonly body?: Uint8Array;
  readonly contentType?: string;
  readonly mailboxId?: string;
  readonly origin?: string;
  readonly scope?: string;
} = {}) => {
  const body = input.body ?? source;
  return new Request(
    `${origin}/api/v1/mail/messages/import?mailboxId=${encodeURIComponent(input.mailboxId ?? inboxId)}`,
    {
      body: Buffer.from(body),
      headers: {
        "content-length": String(body.byteLength),
        "content-type": input.contentType ?? "message/rfc822",
        host: "mail.example.com",
        origin: input.origin ?? origin,
        "x-veda-mail-session-scope": input.scope ?? mailSessionScope(connection),
      },
      method: "POST",
    },
  );
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.listMailboxes.mockResolvedValue([{
    id: inboxId, name: "Inbox", rights: { mayAddItems: true }, role: "inbox",
  }]);
  mocks.importMessageSource.mockResolvedValue({ messageId: id.message("imported") });
});

describe("RFC 5322 message import route", () => {
  it("imports exact bytes into an authorized mailbox and audits success", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.importMessageSource).toHaveBeenCalledWith({
      mailboxId: inboxId,
      signal: expect.any(AbortSignal),
      source,
    });
    expect(mocks.appendSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member.message.imported", count: 1, outcome: "success",
    }));
  });

  it("rejects stale scope, cross-origin, wrong media, missing and forbidden mailboxes", async () => {
    expect((await POST(request({ scope: "stale" }))).status).toBe(409);
    expect((await POST(request({ origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(request({ contentType: "text/plain" }))).status).toBe(415);
    mocks.listMailboxes.mockResolvedValueOnce([]);
    expect((await POST(request())).status).toBe(404);
    mocks.listMailboxes.mockResolvedValueOnce([{
      id: inboxId, name: "Inbox", rights: { mayAddItems: false }, role: "inbox",
    }]);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.importMessageSource).not.toHaveBeenCalled();
  });

  it("rejects content-length mismatches before provider I/O", async () => {
    const mismatched = request();
    const headers = new Headers(mismatched.headers);
    headers.set("content-length", String(source.byteLength + 1));
    const response = await POST(new Request(mismatched.url, {
      body: Buffer.from(source), headers, method: "POST",
    }));
    expect(response.status).toBe(400);
    expect(mocks.importMessageSource).not.toHaveBeenCalled();
  });
});
