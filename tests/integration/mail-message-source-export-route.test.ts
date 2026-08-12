import { beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";

import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  appendSecurityAudit: vi.fn(), connection: { id: "archive-connection", providerId: "mock" },
  downloadMessageSource: vi.fn(), getCurrentConnection: vi.fn(), getMailService: vi.fn(), release: vi.fn(),
}));
vi.mock("@/server/connections/connection-session", () => ({ getCurrentConnection: mocks.getCurrentConnection }));
vi.mock("@/server/mail/mail-service", () => ({ getMailService: mocks.getMailService }));
vi.mock("@/server/mail/attachment-download-concurrency", () => ({ acquireAttachmentDownloadLease: vi.fn(() => ({ release: mocks.release })) }));
vi.mock("@/server/security/rate-limit", () => ({ assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn() }));
vi.mock("@/server/security-audit/security-audit", async (original) => ({
  ...(await original()), appendSecurityAudit: mocks.appendSecurityAudit,
  memberAuditActor: vi.fn(() => ({ actorId: "actor", actorType: "member" })),
}));

import { POST } from "@/app/api/v1/mail/messages/export/route";

const origin = "https://mail.example.com";
const request = (messageIds: readonly string[], scope = mailSessionScope(mocks.connection)) => new Request(
  `${origin}/api/v1/mail/messages/export`, {
    body: JSON.stringify({ messageIds }), headers: { "content-type": "application/json", host: "mail.example.com", origin, "x-veda-mail-session-scope": scope }, method: "POST",
  },
);
const body = (text: string) => { const bytes = new TextEncoder().encode(text); return {
  body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), size: bytes.byteLength,
}; };

beforeEach(() => {
  vi.clearAllMocks(); mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({ downloadMessageSource: mocks.downloadMessageSource });
  mocks.downloadMessageSource.mockImplementation(async ({ messageId }: { messageId: string }) => body(`Message-ID: <${messageId}>\r\n\r\nBody`));
});

describe("bulk message source export route", () => {
  it("returns a hardened ZIP with one exact EML entry per selected message", async () => {
    const response = await POST(request(["one", "two"]));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="veda-mail-messages.zip"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(archive)).toEqual(["message-001.eml", "message-002.eml"]);
    expect(new TextDecoder().decode(archive["message-002.eml"])).toContain("<two>");
    expect(mocks.appendSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "member.message.exported", count: 2, outcome: "success" }));
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("rejects stale scope, duplicate ids, and selections over 20 before provider access", async () => {
    expect((await POST(request(["one"], "stale"))).status).toBe(409);
    expect((await POST(request(["one", "one"]))).status).toBe(400);
    expect((await POST(request(Array.from({ length: 21 }, (_, index) => `m-${index}`)))).status).toBe(400);
    expect(mocks.downloadMessageSource).not.toHaveBeenCalled();
  });
});
