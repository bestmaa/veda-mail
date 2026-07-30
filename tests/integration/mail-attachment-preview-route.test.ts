import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "attachment-preview-connection" },
  dispose: vi.fn(),
  downloadAttachment: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  prepareTextAttachmentPreview: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mail/attachment-preview", () => ({
  prepareTextAttachmentPreview: mocks.prepareTextAttachmentPreview,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import {
  GET,
  HEAD,
  POST,
} from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/preview/route";

const origin = "https://mail.example.com";
const request = (
  input: {
    readonly body?: string;
    readonly headers?: HeadersInit;
    readonly query?: string;
  } = {},
): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/message-42/attachments/attachment-42/preview${input.query ?? ""}`,
    {
      body: input.body ?? JSON.stringify({ renderer: "text" }),
      headers: {
        "content-type": "application/json",
        host: "mail.example.com",
        origin,
        ...input.headers,
      },
      method: "POST",
    },
  );

const context = (
  messageId = "message-42",
  attachmentId = "attachment-42",
) => ({ params: Promise.resolve({ attachmentId, messageId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
  });
  mocks.prepareTextAttachmentPreview.mockResolvedValue({
    bytes: new TextEncoder().encode("safe preview"),
    dispose: mocks.dispose,
  });
});

describe("received attachment preview route", () => {
  it("returns scanned text with hardened non-cacheable headers", async () => {
    const routeRequest = request();
    const response = await POST(routeRequest, context());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("safe preview");
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("content-length")).toBe("12");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="attachment-preview.txt"',
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.prepareTextAttachmentPreview).toHaveBeenCalledWith(
      {
        attachmentId: "attachment-42",
        messageId: "message-42",
        signal: routeRequest.signal,
        subject: mocks.connection.id,
      },
      expect.objectContaining({
        download: expect.any(Function),
        mimeDetector: expect.any(Object),
        scanner: expect.any(Object),
      }),
    );
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "attachment-preview",
      2_000,
      20,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "attachment-preview",
      mocks.connection.id,
      10,
      60_000,
    );
  });

  it("requires authentication and an explicit same-origin POST", async () => {
    const crossOrigin = await POST(
      request({ headers: { origin: "https://evil.example" } }),
      context(),
    );
    expect(crossOrigin.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();

    const noOrigin = await POST(
      request({ headers: { origin: "" } }),
      context(),
    );
    expect(noOrigin.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();

    mocks.getCurrentConnection.mockRejectedValue(
      new ApiError("Sign in required.", "AUTHENTICATION_REQUIRED", 401),
    );
    const unauthenticated = await POST(request(), context());
    expect(unauthenticated.status).toBe(401);
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it("rejects ranges, queries, malformed IDs, and body variants", async () => {
    const ranged = await POST(
      request({ headers: { range: "bytes=0-1" } }),
      context(),
    );
    expect(ranged.status).toBe(416);

    const queried = await POST(request({ query: "?renderer=text" }), context());
    expect(queried.status).toBe(400);

    const malformed = await POST(
      request(),
      context("message-42", "../../provider-blob"),
    );
    expect(malformed.status).toBe(400);

    const bodyVariant = await POST(
      request({ body: JSON.stringify({ renderer: "html" }) }),
      context(),
    );
    expect(bodyVariant.status).toBe(400);
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.prepareTextAttachmentPreview).not.toHaveBeenCalled();
  });

  it("disables GET and HEAD without touching auth or providers", async () => {
    for (const response of [GET(), HEAD()]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "ATTACHMENT_PREVIEW_METHOD_NOT_ALLOWED" },
      });
    }
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it.each([
    [413, "ATTACHMENT_PREVIEW_TOO_LARGE"],
    [415, "ATTACHMENT_PREVIEW_UNSUPPORTED"],
    [422, "ATTACHMENT_PREVIEW_BLOCKED"],
    [429, "ATTACHMENT_PREVIEW_BUSY"],
    [503, "ATTACHMENT_PREVIEW_SCANNER_UNAVAILABLE"],
    [504, "ATTACHMENT_PREVIEW_TIMEOUT"],
  ])("preserves safe preview failure %i", async (status, code) => {
    mocks.prepareTextAttachmentPreview.mockRejectedValue(
      new ApiError("Safe public preview failure.", code, status),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: { code, message: "Safe public preview failure." },
    });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
  });

  it("redacts unexpected provider failures without logging details", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.getMailService.mockRejectedValue(
      new Error("https://provider.invalid/private-preview-blob"),
    );

    const response = await POST(request(), context());
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(payload).toContain("ATTACHMENT_PROVIDER_FAILED");
    expect(payload).not.toContain("private-preview-blob");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
