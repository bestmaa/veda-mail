import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "inline-image-connection" },
  dispose: vi.fn(),
  downloadAttachment: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  prepareInlineImage: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mail/inline-image", () => ({
  prepareInlineImage: mocks.prepareInlineImage,
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import {
  GET,
  HEAD,
  POST,
} from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/inline-image/route";

const origin = "https://mail.example.com";
const request = (
  input: {
    readonly body?: string;
    readonly headers?: HeadersInit;
    readonly query?: string;
  } = {},
): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/message-42/attachments/attachment-42/inline-image${input.query ?? ""}`,
    {
      body: input.body ?? JSON.stringify({ renderer: "inline-image" }),
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
  mocks.prepareInlineImage.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    dispose: mocks.dispose,
    mimeType: "image/webp",
  });
});

describe("received inline image route", () => {
  it("returns canonical WebP with hardened non-cacheable headers", async () => {
    const routeRequest = request();
    const response = await POST(routeRequest, context());

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.prepareInlineImage).toHaveBeenCalledWith(
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
      "inline-image",
      2_000,
      120,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "inline-image",
      mocks.connection.id,
      60,
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

    const queried = await POST(request({ query: "?inline=true" }), context());
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
    expect(mocks.prepareInlineImage).not.toHaveBeenCalled();
  });

  it("disables GET and HEAD without touching auth or providers", async () => {
    for (const response of [GET(), HEAD()]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INLINE_IMAGE_METHOD_NOT_ALLOWED" },
      });
    }
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });

  it.each([
    [413, "INLINE_IMAGE_TOO_LARGE"],
    [415, "INLINE_IMAGE_UNSUPPORTED"],
    [422, "INLINE_IMAGE_BLOCKED"],
    [429, "INLINE_IMAGE_BUSY"],
    [503, "INLINE_IMAGE_SCANNER_UNAVAILABLE"],
    [504, "INLINE_IMAGE_TIMEOUT"],
  ])("preserves safe inline image failure %i", async (status, code) => {
    mocks.prepareInlineImage.mockRejectedValue(
      new ApiError("Safe public inline image failure.", code, status),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      error: { code, message: "Safe public inline image failure." },
    });
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
  });
});
