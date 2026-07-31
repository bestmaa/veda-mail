import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  connection: { id: "archive-lifecycle-connection" },
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
  query = "",
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
  it("accepts the current native-download query scope without a matching header", async () => {
    mocks.downloadAttachment.mockResolvedValueOnce({
      body: byteStream(Uint8Array.of(1, 2, 3)),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: 3,
    });
    const scope = mailSessionScope(mocks.connection);

    const response = await GET(
      request(`?sessionScope=${encodeURIComponent(scope)}`, "stale-scope"),
      context(),
    );

    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(mocks.downloadAttachment).toHaveBeenCalledOnce();
  });

  it("rejects a stale native-download query before provider access", async () => {
    const response = await GET(
      request("?sessionScope=stale-scope"),
      context(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MAIL_SESSION_CHANGED" },
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

  it("invalidates a partial ZIP on midstream failure", async () => {
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
    expect(response.status).toBe(200);
    await expect(response.arrayBuffer()).rejects.toBeDefined();
  });

  it("releases archive capacity immediately after browser cancellation", async () => {
    const cancelled = vi.fn();
    mocks.downloadAttachment.mockResolvedValueOnce({
      body: new ReadableStream<Uint8Array>({
        cancel: cancelled,
        pull(controller) {
          controller.enqueue(Uint8Array.of(1));
        },
      }),
      mimeType: "application/octet-stream",
      name: "one.bin",
      size: null,
    });
    const first = await GET(request(), context());
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
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
