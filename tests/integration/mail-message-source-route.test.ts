import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";
import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES } from "@/domain/mail/message-source";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  appendSecurityAudit: vi.fn(),
  connection: { id: "source-connection", providerId: "mock" },
  downloadMessageSource: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: vi.fn(), assertSubjectRateLimit: vi.fn(),
}));
vi.mock("@/server/security-audit/security-audit", async (original) => ({
  ...(await original()),
  appendSecurityAudit: mocks.appendSecurityAudit,
  memberAuditActor: vi.fn(() => ({ actorId: "actor", actorType: "member" })),
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/source/route";

const origin = "https://mail.example.com";
const request = (headers: HeadersInit = {}) => new Request(
  `${origin}/api/v1/mail/messages/message-42/source`,
  { headers: { host: "mail.example.com", origin,
    "x-veda-mail-session-scope": mailSessionScope(mocks.connection), ...headers } },
);
const context = (messageId = "message-42") => ({ params: Promise.resolve({ messageId }) });
const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({
  start(controller) { controller.enqueue(bytes); controller.close(); },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadMessageSource: mocks.downloadMessageSource,
  });
  mocks.downloadMessageSource.mockResolvedValue({
    body: stream(new TextEncoder().encode("Subject: Test\r\n\r\nBody")),
    size: 21,
  });
});

describe("message source export route", () => {
  it("returns exact RFC 5322 bytes with hardened download headers", async () => {
    const routeRequest = request();
    const response = await GET(routeRequest, context());

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.text()).resolves.toBe("Subject: Test\r\n\r\nBody");
    expect(response.headers.get("content-type")).toBe("message/rfc822");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="message.eml"',
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(mocks.downloadMessageSource).toHaveBeenCalledWith({
      maxBytes: MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
      messageId: "message-42",
      signal: routeRequest.signal,
    });
    expect(mocks.appendSecurityAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "member.message.exported", count: 1, outcome: "success",
    }));
  });

  it("rejects stale sessions, ranges, and malformed opaque identifiers", async () => {
    expect((await GET(request({ "x-veda-mail-session-scope": "stale" }), context())).status)
      .toBe(409);
    expect((await GET(request({ range: "bytes=0-1" }), context())).status)
      .toBe(416);
    expect((await GET(request(), context("../../blob"))).status).toBe(400);
    expect(mocks.downloadMessageSource).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "MESSAGE_NOT_FOUND"],
    ["size_limit_exceeded", 413, "MESSAGE_SOURCE_TOO_LARGE"],
    ["provider_failure", 502, "MESSAGE_SOURCE_PROVIDER_FAILED"],
    ["aborted", 499, "MESSAGE_SOURCE_ABORTED"],
  ] as const)("redacts %s provider failures", async (code, status, publicCode) => {
    mocks.downloadMessageSource.mockRejectedValue(
      new MessageSourceDownloadError(code, "secret provider blob"),
    );
    const response = await GET(request(), context());
    const payload = JSON.stringify(await response.json());
    expect(response.status).toBe(status);
    expect(payload).toContain(publicCode);
    expect(payload).not.toContain("secret provider blob");
  });
});
