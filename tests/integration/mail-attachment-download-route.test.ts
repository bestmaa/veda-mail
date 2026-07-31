import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "attachment-download-connection" },
  downloadAttachment: vi.fn(),
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
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/route";
import { ATTACHMENT_DOWNLOAD_MAX_BYTES } from "@/server/mail/attachment-download-http";

const origin = "https://mail.example.com";
const request = (init?: RequestInit): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/message-42/attachments/attachment-42`,
    {
      ...init,
      headers: {
        host: "mail.example.com",
        origin,
        "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
        ...init?.headers,
      },
    },
  );

const context = (
  messageId = "message-42",
  attachmentId = "attachment-42",
) => ({ params: Promise.resolve({ attachmentId, messageId }) });

const byteStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
  });
  mocks.downloadAttachment.mockResolvedValue({
    body: byteStream(new Uint8Array([1, 2, 3])),
    name: 'réport\r\n"../../secret.pdf',
    size: 3,
  });
});

describe("received attachment download route", () => {
  it("rejects a stale scope before invoking the provider", async () => {
    const response = await GET(
      request({
        headers: { "x-veda-mail-session-scope": "stale-scope" },
      }),
      context(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_SESSION_CHANGED" },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("streams authenticated bytes with hardened non-cacheable headers", async () => {
    const routeRequest = request();
    const response = await GET(routeRequest, context());

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("content-disposition")).toContain(
      "attachment; filename=",
    );
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''",
    );
    expect(response.headers.get("content-disposition")).not.toMatch(
      /[\r\n]/u,
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(response.headers.get("x-download-options")).toBe("noopen");
    expect(mocks.getMailService).toHaveBeenCalledWith(mocks.connection);
    expect(mocks.downloadAttachment).toHaveBeenCalledWith({
      attachmentId: "attachment-42",
      maxBytes: ATTACHMENT_DOWNLOAD_MAX_BYTES,
      messageId: "message-42",
      signal: routeRequest.signal,
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "attachment-download",
      2_000,
      120,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "attachment-download",
      mocks.connection.id,
      60,
      60_000,
    );
  });

  it("authenticates before resolving or invoking a provider", async () => {
    mocks.getCurrentConnection.mockRejectedValue(
      new ApiError("Sign in required.", "AUTHENTICATION_REQUIRED", 401),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and byte-range requests before provider access", async () => {
    const crossOrigin = request({ headers: { origin: "https://evil.example" } });
    const crossOriginResponse = await GET(crossOrigin, context());
    expect(crossOriginResponse.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();

    const rangeResponse = await GET(
      request({ headers: { range: "bytes=0-1" } }),
      context(),
    );
    expect(rangeResponse.status).toBe(416);
    expect(rangeResponse.headers.get("accept-ranges")).toBe("none");
    await expect(rangeResponse.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_RANGE_NOT_SATISFIABLE" },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it("rejects malformed opaque route identifiers before provider access", async () => {
    const response = await GET(
      request(),
      context("message-42", "../../provider-blob"),
    );

    expect(response.status).toBe(400);
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "ATTACHMENT_NOT_FOUND"],
    ["size_limit_exceeded", 413, "ATTACHMENT_TOO_LARGE"],
    ["timeout", 504, "ATTACHMENT_PROVIDER_TIMEOUT"],
    ["aborted", 499, "ATTACHMENT_DOWNLOAD_ABORTED"],
    ["provider_failure", 502, "ATTACHMENT_PROVIDER_FAILED"],
    ["invalid_request", 400, "INVALID_ATTACHMENT_DOWNLOAD"],
  ] as const)(
    "maps and redacts %s provider errors",
    async (code, status, publicCode) => {
      mocks.downloadAttachment.mockRejectedValue(
        new AttachmentDownloadError(code, "secret provider blob identifier"),
      );

      const response = await GET(request(), context());
      const payload = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(payload).toContain(publicCode);
      expect(payload).not.toContain("secret provider blob identifier");
    },
  );

  it("redacts unexpected provider errors without logging their details", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.downloadAttachment.mockRejectedValue(
      new Error("https://provider.invalid/download/private-blob"),
    );

    const response = await GET(request(), context());
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(payload).not.toContain("private-blob");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects an oversized provider result before headers and cancels it", async () => {
    let cancelled = false;
    mocks.downloadAttachment.mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        cancel: () => {
          cancelled = true;
        },
      }),
      name: "oversized.bin",
      size: ATTACHMENT_DOWNLOAD_MAX_BYTES + 1,
    });

    const response = await GET(request(), context());
    await Promise.resolve();

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
  });
});
