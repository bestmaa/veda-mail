import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { JmapAttachmentTransport } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JMAP attachment nullable size", () => {
  it("uses the provider response length and configured byte ceiling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Uint8Array.of(1, 2, 3, 4), {
          headers: { "content-length": "4" },
        }),
      ),
    );
    const transport = new JmapAttachmentTransport({
      authorizationHeader: () => "Bearer provider-secret",
      baseUrl: "https://mail.example.com",
      downloadUrl:
        "https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}",
      maxDownloadBytes: 4,
      maxUploadBytes: 1,
      uploadUrl: "https://mail.example.com/upload/{accountId}",
    });
    const attachment = transport.bindMessageAttachment({
      accountId: "account-one",
      fileName: "unknown-size.bin",
      mediaType: "application/octet-stream",
      messageId: "message-one",
      providerBlobId: "unknown-size-provider-blob",
      size: null,
    });

    const downloaded = await transport.download({
      attachment,
      maxBytes: 4,
      messageId: "message-one",
    });

    expect(downloaded.size).toBeNull();
    await expect(
      new Response(downloaded.body).arrayBuffer(),
    ).resolves.toHaveProperty("byteLength", 4);
  });
});
