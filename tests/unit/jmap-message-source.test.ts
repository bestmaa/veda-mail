import { beforeEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";

const mocks = vi.hoisted(() => ({
  requestJmapAttachment: vi.fn(),
  resolveJmapAttachmentUrl: vi.fn(),
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/jmap-attachment-request", () => ({
  requestJmapAttachment: mocks.requestJmapAttachment,
}));
vi.mock("@/infrastructure/providers/stalwart-jmap/jmap-attachment-url", () => ({
  resolveJmapAttachmentUrl: mocks.resolveJmapAttachmentUrl,
}));

import { downloadStalwartMessageSource } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-source";

const source = new TextEncoder().encode("Subject: Exact\r\n\r\nBody");
const client = {
  authorizationForProviderTransport: vi.fn().mockResolvedValue("Bearer private"),
  getSession: vi.fn().mockResolvedValue({
    apiUrl: "https://mail.example/jmap",
    downloadUrl: "https://mail.example/download/{accountId}/{blobId}/{name}?type={type}",
  }),
  request: vi.fn().mockResolvedValue({}),
  result: vi.fn().mockReturnValue({
    accountId: "account-one",
    list: [{ blobId: "secret-blob", id: "message-one", size: source.byteLength }],
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveJmapAttachmentUrl.mockResolvedValue(new URL("https://mail.example/download"));
  mocks.requestJmapAttachment.mockResolvedValue(new Response(source, {
    headers: { "content-length": String(source.byteLength) },
  }));
});

describe("JMAP message source export", () => {
  it("looks up the exact message blob and streams exact bounded bytes", async () => {
    const result = await downloadStalwartMessageSource(
      client as never,
      "account-one",
      { maxBytes: 50_000, messageId: id.message("message-one") },
    );
    await expect(new Response(result.body).text()).resolves.toBe(
      "Subject: Exact\r\n\r\nBody",
    );
    expect(client.request).toHaveBeenCalledWith(expect.arrayContaining([
      expect.arrayContaining(["Email/get", expect.objectContaining({
        ids: ["message-one"], properties: ["id", "blobId", "size"],
      })]),
    ]), expect.any(Array), undefined);
    expect(mocks.resolveJmapAttachmentUrl).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "download",
      expect.objectContaining({ blobId: "secret-blob", type: "message/rfc822" }),
    );
    expect(result.size).toBe(source.byteLength);
  });

  it("rejects mismatched and oversized provider metadata before download", async () => {
    client.result.mockReturnValueOnce({ accountId: "other", list: [] });
    await expect(downloadStalwartMessageSource(client as never, "account-one", {
      maxBytes: 50_000, messageId: id.message("message-one"),
    })).rejects.toMatchObject({ code: "not_found" } satisfies Partial<MessageSourceDownloadError>);

    client.result.mockReturnValueOnce({ accountId: "account-one", list: [
      { blobId: "secret-blob", id: "message-one", size: 50_001 },
    ] });
    await expect(downloadStalwartMessageSource(client as never, "account-one", {
      maxBytes: 50_000, messageId: id.message("message-one"),
    })).rejects.toMatchObject({ code: "size_limit_exceeded" });
    expect(mocks.requestJmapAttachment).not.toHaveBeenCalled();
  });
});
