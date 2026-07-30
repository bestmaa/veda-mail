import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { AttachmentQuarantineError } from "@/server/attachments";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "attachment-import-connection", providerId: "mock" },
  getCurrentConnection: vi.fn(),
  importOriginalAttachment: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/attachment-original-import", () => {
  return { importOriginalAttachment: mocks.importOriginalAttachment };
});
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));

import { POST } from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/imports/route";

const origin = "https://mail.example.com";
const draftId = "8ec9269d-9aa7-4c7a-97dd-440d011fbb8f";
const route = (
  messageId = "opaque-message_42",
  attachmentId = "opaque-attachment_42",
) => ({ params: Promise.resolve({ attachmentId, messageId }) });
const request = (
  body: unknown = { draftId },
  init: Omit<RequestInit, "body"> = {},
): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/opaque-message_42/attachments/opaque-attachment_42/imports`,
    {
      ...init,
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        host: "mail.example.com",
        origin,
        ...init.headers,
      },
      method: "POST",
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.importOriginalAttachment.mockResolvedValue({
    contentLength: 12,
    createdAt: "2026-07-30T10:00:00.000Z",
    detectedMimeType: "text/plain",
    expiresAt: "2026-07-30T10:30:00.000Z",
    fileName: "forwarded.txt",
    id: "a".repeat(32),
    state: "clean",
  });
});

describe("forward original attachment import route", () => {
  it("returns only a normal quarantine attachment on success", async () => {
    const routeRequest = request();
    const response = await POST(routeRequest, route());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        expiresAt: "2026-07-30T10:30:00.000Z",
        id: "a".repeat(32),
        mimeType: "text/plain",
        name: "forwarded.txt",
        size: 12,
      },
    });
    expect(mocks.importOriginalAttachment).toHaveBeenCalledWith({
      attachmentId: "opaque-attachment_42",
      connection: mocks.connection,
      draftId,
      messageId: "opaque-message_42",
      signal: routeRequest.signal,
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "attachment-import",
      1_000,
      60,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "attachment-import",
      mocks.connection.id,
      20,
      60_000,
    );
  });

  it("authenticates before importing from a provider", async () => {
    mocks.getCurrentConnection.mockRejectedValue(
      new ApiError("Sign in required.", "MEMBER_SESSION_REQUIRED", 401),
    );

    const response = await POST(request(), route());

    expect(response.status).toBe(401);
    expect(mocks.importOriginalAttachment).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before authentication", async () => {
    const response = await POST(
      request(undefined, { headers: { origin: "https://evil.example" } }),
      route(),
    );

    expect(response.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    expect(mocks.importOriginalAttachment).not.toHaveBeenCalled();
  });

  it.each(["blobId", "part", "name", "type", "size", "providerId"])(
    "rejects the client-supplied provider field %s",
    async (field) => {
      const response = await POST(
        request({ draftId, [field]: "forged-provider-value" }),
        route(),
      );

      expect(response.status).toBe(400);
      expect(mocks.importOriginalAttachment).not.toHaveBeenCalled();
    },
  );

  it("requires a valid draft UUID and JSON content type", async () => {
    const invalidDraft = await POST(request({ draftId: "not-a-draft" }), route());
    expect(invalidDraft.status).toBe(400);

    const wrongMedia = await POST(
      request(undefined, { headers: { "content-type": "text/plain" } }),
      route(),
    );
    expect(wrongMedia.status).toBe(415);
    expect(mocks.importOriginalAttachment).not.toHaveBeenCalled();
  });

  it("rejects malformed opaque identifiers before provider access", async () => {
    const response = await POST(request(), route("message", "../../blob-id"));

    expect(response.status).toBe(400);
    expect(mocks.importOriginalAttachment).not.toHaveBeenCalled();
  });

  it("keeps well-formed forged and wrong-message identifiers opaque", async () => {
    mocks.importOriginalAttachment.mockRejectedValue(
      new AttachmentDownloadError(
        "not_found",
        "secret account/blob/part mismatch",
      ),
    );

    const response = await POST(request(), route());
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(404);
    expect(payload).toContain("ATTACHMENT_NOT_FOUND");
    expect(payload).not.toContain("secret account/blob/part mismatch");
  });

  it("fails closed when malware scanning rejects imported bytes", async () => {
    mocks.importOriginalAttachment.mockRejectedValue(
      new AttachmentQuarantineError(
        "Attachment was rejected by malware scanning.",
        "ATTACHMENT_REJECTED",
        422,
      ),
    );

    const response = await POST(request(), route());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_REJECTED" },
    });
  });
});
