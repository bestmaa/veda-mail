import { beforeEach, describe, expect, it, vi } from "vitest";

import { mailSessionScope } from "@/server/connections/mail-session-scope";

const mocks = vi.hoisted(() => ({
  connection: { id: "active-content-download-connection" },
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
  assertRequestRateLimit: vi.fn(),
  assertSubjectRateLimit: vi.fn(),
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/attachments/[attachmentId]/route";

const origin = "https://mail.example.com";
const request = (): Request =>
  new Request(
    `${origin}/api/v1/mail/messages/message-active/attachments/attachment-active`,
    {
      headers: {
        host: "mail.example.com",
        origin,
        "x-veda-mail-session-scope": mailSessionScope(mocks.connection),
      },
    },
  );

const context = {
  params: Promise.resolve({
    attachmentId: "attachment-active",
    messageId: "message-active",
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(mocks.connection);
  mocks.getMailService.mockResolvedValue({
    downloadAttachment: mocks.downloadAttachment,
  });
});

describe("active-content attachment download", () => {
  it.each([
    [
      "HTML",
      "invoice.html",
      "text/html",
      "<script>top.location='https://evil.example'</script>",
    ],
    [
      "SVG",
      "logo.svg",
      "image/svg+xml",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    ],
  ])(
    "forces hostile %s bytes through the inert download response contract",
    async (_kind, name, mimeType, source) => {
      const bytes = new TextEncoder().encode(source);
      mocks.downloadAttachment.mockResolvedValue({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        mimeType,
        name,
        size: bytes.byteLength,
      });

      const response = await GET(request(), context);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(source);
      expect(response.headers.get("content-type")).toBe(
        "application/octet-stream",
      );
      const disposition = response.headers.get("content-disposition") ?? "";
      expect(disposition).toMatch(/^attachment;/u);
      expect(disposition).not.toMatch(/^inline\b/iu);
      expect(response.headers.get("content-security-policy")).toBe(
        "sandbox; default-src 'none'",
      );
      expect(response.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin",
      );
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("accept-ranges")).toBe("none");
      expect(response.headers.get("x-download-options")).toBe("noopen");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, no-transform, max-age=0",
      );
    },
  );
});
