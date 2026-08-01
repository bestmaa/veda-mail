import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { ApiError } from "@/transport/http/api-error";

const mocks = vi.hoisted(() => ({
  connection: { id: "archive-lifecycle-connection" },
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
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/archive/route";

const origin = "https://mail.example.com";
const messageId = id.message("message-lifecycle");
const item = {
  disposition: "attachment" as const,
  id: id.attachment("attachment-lifecycle"),
  mimeType: "application/octet-stream",
  name: "one.bin",
  size: 3,
};
const request = (
  query = `?ticket=${"t".repeat(43)}`,
  sessionScope = mailSessionScope(mocks.connection),
): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/${messageId}/attachments/archive${query}`,
    {
      headers: {
        host: "mail.example.com",
        origin,
        "x-veda-mail-session-scope": sessionScope,
      },
    },
  );
const context = () => ({ params: Promise.resolve({ messageId }) });
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
  mocks.listMessageAttachments.mockResolvedValue([item]);
});

afterEach(() => {
  expect(mocks.getMessage).not.toHaveBeenCalled();
});

describe("attachment archive lifecycle", () => {
  it("accepts a single-use ticket without a matching scope header", async () => {
    mocks.downloadAttachment.mockResolvedValueOnce({
      body: byteStream(Uint8Array.of(1, 2, 3)),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: 3,
    });
    const response = await GET(
      request(`?ticket=${"t".repeat(43)}`, "stale-scope"),
      context(),
    );

    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(mocks.downloadAttachment).toHaveBeenCalledOnce();
  });

  it("rejects an invalid or replayed ticket before provider access", async () => {
    mocks.consumeAttachmentArchiveTicket.mockImplementationOnce(() => {
      throw new ApiError(
        "The attachment archive ticket is invalid or expired.",
        "ATTACHMENT_ARCHIVE_TICKET_INVALID",
        403,
      );
    });
    const response = await GET(request("?ticket=stale-ticket"), context());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_ARCHIVE_TICKET_INVALID" },
    });
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.listMessageAttachments).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("redacts provider failures before response bytes are emitted", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.downloadAttachment.mockRejectedValueOnce(
      new AttachmentDownloadError(
        "provider_failure",
        "https://provider.invalid/private-blob",
      ),
    );

    const response = await GET(request(), context());
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(response.headers.get("content-disposition")).toContain(
      "attachment-archive-error.json",
    );
    expect(payload).toContain("ATTACHMENT_ARCHIVE_PROVIDER_FAILED");
    expect(payload).not.toContain("private-blob");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("blocks a ZIP before response bytes on a midstream scan failure", async () => {
    mocks.downloadAttachment.mockResolvedValueOnce({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
          controller.error(new Error("provider stream secret"));
        },
      }),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: 3,
    });

    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = JSON.stringify(await response.json());
    expect(payload).toContain("ATTACHMENT_SCANNER_UNAVAILABLE");
    expect(payload).not.toContain("provider stream secret");
  });

  it("releases archive capacity immediately after browser cancellation", async () => {
    mocks.downloadAttachment.mockResolvedValueOnce({
      body: byteStream(Uint8Array.of(1, 2, 3)),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: 3,
    });
    const first = await GET(request(), context());
    const busy = await GET(request(), context());
    expect(busy.status).toBe(429);
    expect(mocks.consumeAttachmentArchiveTicket).toHaveBeenCalledOnce();
    const reader = first.body?.getReader();
    await reader?.read();
    await reader?.read();
    await reader?.cancel("browser stopped");

    mocks.downloadAttachment.mockResolvedValueOnce({
      body: byteStream(Uint8Array.of(1, 2, 3)),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: 3,
    });
    const retry = await GET(request(), context());
    expect(retry.status).toBe(200);
    await retry.arrayBuffer();
    expect(mocks.consumeAttachmentArchiveTicket).toHaveBeenCalledTimes(2);
  });
});
