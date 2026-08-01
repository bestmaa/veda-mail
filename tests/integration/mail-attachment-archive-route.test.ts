import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";
import { parseStoreZip } from "@/../tests/support/store-zip";
const mocks = vi.hoisted(() => ({
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
  connection: { id: "archive-connection" },
  consumeAttachmentArchiveTicket: vi.fn(),
  downloadAttachment: vi.fn(),
  getCurrentConnection: vi.fn(),
  getMessage: vi.fn(),
  getMailService: vi.fn(),
  listMessageAttachments: vi.fn(),
}));
vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/mail/attachment-archive-ticket", () => ({
  consumeAttachmentArchiveTicket: mocks.consumeAttachmentArchiveTicket,
  issueAttachmentArchiveTicket: vi.fn(),
}));
vi.mock("@/server/security/rate-limit", () => ({
  assertRequestRateLimit: mocks.assertRequestRateLimit,
  assertSubjectRateLimit: mocks.assertSubjectRateLimit,
}));
import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/archive/route";
import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
const origin = "https://mail.example.com";
const messageId = id.message("message-archive");
const attachments: readonly Attachment[] = [
  {
    disposition: "attachment",
    id: id.attachment("attachment-one"),
    mimeType: "text/plain",
    name: "one.txt",
    size: 3,
  },
  {
    disposition: "attachment",
    id: id.attachment("attachment-two"),
    mimeType: "application/octet-stream",
    name: "two.bin",
    size: 2,
  },
];
const contents = new Map<string, Uint8Array>([
  ["attachment-one", Uint8Array.of(1, 2, 3)],
  ["attachment-two", Uint8Array.of(254, 255)],
]);
const request = (path = "?ticket=" + "t".repeat(43), init?: RequestInit): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/${messageId}/attachments/archive${path}`,
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
const context = (value: string = messageId) => ({
  params: Promise.resolve({ messageId: value }),
});
const byteStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
    getMessage: mocks.getMessage,
    listMessageAttachments: mocks.listMessageAttachments,
  });
  mocks.listMessageAttachments.mockResolvedValue(attachments);
  mocks.downloadAttachment.mockImplementation(
    async ({ attachmentId }: { readonly attachmentId: string }) => {
      const bytes = contents.get(attachmentId);
      if (!bytes) throw new Error("private provider locator");
      return {
        body: byteStream(bytes),
        mimeType: "application/octet-stream",
        name: "ignored-provider-name.bin",
        size: bytes.byteLength,
      };
    },
  );
});
describe("attachment archive route", () => {
  it("streams an exact ZIP with hardened headers and authoritative IDs", async () => {
    const routeRequest = request();
    const response = await GET(routeRequest, context());
    const parsed = parseStoreZip(new Uint8Array(await response.arrayBuffer()));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''attachments.zip",
    );
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(parsed.map(({ name }) => name)).toEqual(["one.txt", "two.bin"]);
    expect(parsed.map(({ bytes }) => [...bytes])).toEqual([
      [1, 2, 3],
      [254, 255],
    ]);
    expect(mocks.listMessageAttachments).toHaveBeenCalledWith({
      messageId,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.listMessageAttachments).toHaveBeenCalledOnce();
    expect(mocks.getMessage).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).toHaveBeenNthCalledWith(1, {
      attachmentId: attachments[0]?.id,
      maxBytes: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
      messageId,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.downloadAttachment).toHaveBeenNthCalledWith(2, {
      attachmentId: attachments[1]?.id,
      maxBytes: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
      messageId,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.assertRequestRateLimit).toHaveBeenCalledWith(
      routeRequest,
      "attachment-archive",
      200,
      10,
      60_000,
    );
    expect(mocks.assertSubjectRateLimit).toHaveBeenCalledWith(
      "attachment-archive",
      mocks.connection.id,
      5,
      60_000,
    );
    expect(mocks.consumeAttachmentArchiveTicket).toHaveBeenCalledWith({
      connectionId: mocks.connection.id,
      messageId,
      ticket: "t".repeat(43),
    });
  });
  it("rejects origin, auth, Range, query, and malformed IDs before provider access", async () => {
    const crossOrigin = await GET(
      request(`?ticket=${"t".repeat(43)}`, {
        headers: { origin: "https://evil.example" },
      }),
      context(),
    );
    expect(crossOrigin.status).toBe(403);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    mocks.getCurrentConnection.mockRejectedValueOnce(
      new ApiError("Sign in required.", "AUTHENTICATION_REQUIRED", 401),
    );
    expect((await GET(request(), context())).status).toBe(401);
    expect((await GET(request(""), context())).status).toBe(403);
    expect(
      (await GET(request("", { headers: { range: "bytes=0-1" } }), context()))
        .status,
    ).toBe(416);
    expect((await GET(request("?attachment=x"), context())).status).toBe(400);
    const duplicate = request("?ticket=first&ticket=second");
    expect((await GET(duplicate, context())).status).toBe(400);
    expect((await GET(request(), context("../../provider-blob"))).status).toBe(
      400,
    );
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.getMessage).not.toHaveBeenCalled();
    expect(mocks.listMessageAttachments).not.toHaveBeenCalled();
  });
  it("rejects empty, excessive-count, per-file, and aggregate metadata", async () => {
    mocks.listMessageAttachments.mockResolvedValueOnce([]);
    let response = await GET(request(), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_ARCHIVE_EMPTY" },
    });
    const excessive = Array.from({ length: 101 }, (_, index) => ({
      ...attachments[0]!,
      id: id.attachment(`many-${index}`),
      name: `many-${index}.txt`,
      size: 1,
    }));
    mocks.listMessageAttachments.mockResolvedValueOnce(excessive);
    response = await GET(request(), context());
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_ARCHIVE_TOO_MANY_ENTRIES" },
    });
    const oversized = [
      {
        ...attachments[0]!,
        size: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES + 1,
      },
    ];
    mocks.listMessageAttachments.mockResolvedValueOnce(oversized);
    response = await GET(request(), context());
    expect(response.status).toBe(413);
    const aggregate = Array.from({ length: 5 }, (_, index) => ({
      ...attachments[0]!,
      id: id.attachment(`large-${index}`),
      name: `large-${index}.bin`,
      size: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
    }));
    mocks.listMessageAttachments.mockResolvedValueOnce(aggregate);
    response = await GET(request(), context());
    expect(response.status).toBe(413);
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("stops before provider access at global/source or subject rate limits", async () => {
    mocks.assertRequestRateLimit.mockImplementationOnce(() => {
      throw new ApiError("Slow down.", "RATE_LIMITED", 429);
    });
    expect((await GET(request(), context())).status).toBe(429);
    expect(mocks.getCurrentConnection).not.toHaveBeenCalled();
    mocks.assertSubjectRateLimit.mockImplementationOnce(() => {
      throw new ApiError("Slow down.", "RATE_LIMITED", 429);
    });
    expect((await GET(request(), context())).status).toBe(429);
    expect(mocks.getCurrentConnection).toHaveBeenCalledOnce();
    expect(mocks.consumeAttachmentArchiveTicket).not.toHaveBeenCalled();
    expect(mocks.getMailService).not.toHaveBeenCalled();
  });
});
