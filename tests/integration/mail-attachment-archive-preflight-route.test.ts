import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  connection: { id: "archive-preflight-connection" },
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

import { HEAD } from "@/app/api/v1/mail/messages/[messageId]/attachments/archive/route";

const origin = "https://mail.example.com";
const messageId = id.message("archive-preflight-message");
const metadata = [
  {
    disposition: "attachment" as const,
    id: id.attachment("preflight-one"),
    mimeType: "text/plain",
    name: "one.txt",
    size: null,
  },
  {
    disposition: "attachment" as const,
    id: id.attachment("preflight-two"),
    mimeType: "text/plain",
    name: "two.txt",
    size: 2,
  },
];
const request = (
  sessionScope = mailSessionScope(mocks.connection),
): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/${messageId}/attachments/archive`,
    {
      headers: {
        host: "mail.example.com",
        origin,
        "x-veda-mail-session-scope": sessionScope,
      },
      method: "HEAD",
    },
  );
const context = () => ({ params: Promise.resolve({ messageId }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
    getMessage: mocks.getMessage,
    listMessageAttachments: mocks.listMessageAttachments,
  });
  mocks.listMessageAttachments.mockResolvedValue(metadata);
});

describe("attachment archive HEAD preflight", () => {
  it("rejects a stale scope before opening the mail service", async () => {
    const response = await HEAD(request("stale-scope"), context());

    expect(response.status).toBe(409);
    expect(response.body).toBeNull();
    expect(mocks.getMailService).not.toHaveBeenCalled();
    expect(mocks.listMessageAttachments).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("validates authoritative metadata without opening attachment bodies", async () => {
    const response = await HEAD(request(), context());

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(mocks.listMessageAttachments).toHaveBeenCalledWith({
      messageId,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.listMessageAttachments).toHaveBeenCalledOnce();
    expect(mocks.getMessage).not.toHaveBeenCalled();
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("returns a bodyless bounded failure for invalid metadata", async () => {
    mocks.listMessageAttachments.mockResolvedValueOnce([]);

    const response = await HEAD(request(), context());

    expect(response.status).toBe(409);
    expect(response.body).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.downloadAttachment).not.toHaveBeenCalled();
  });

  it("shares archive concurrency and releases it after preflight", async () => {
    let resolveList!: (value: typeof metadata) => void;
    mocks.listMessageAttachments.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const first = HEAD(request(), context());
    await vi.waitFor(() =>
      expect(mocks.listMessageAttachments).toHaveBeenCalledOnce(),
    );

    expect((await HEAD(request(), context())).status).toBe(429);
    resolveList(metadata);
    expect((await first).status).toBe(204);
    expect((await HEAD(request(), context())).status).toBe(204);
  });
});
