import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { JmapAttachmentTransport } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";

afterEach(() => vi.unstubAllGlobals());

const transport = (maxDownloadBytes = 4) => new JmapAttachmentTransport({
  authorizationHeader: () => "Bearer provider-secret",
  baseUrl: "https://mail.example.com",
  downloadUrl:
    "https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}",
  maxDownloadBytes,
  maxUploadBytes: 1,
  uploadUrl: "https://mail.example.com/upload/{accountId}",
});

const attachment = (
  owner: JmapAttachmentTransport,
  size: number | null,
) => owner.bindMessageAttachment({
  accountId: "account-one",
  fileName: "chunked.bin",
  mediaType: "application/octet-stream",
  messageId: "message-one",
  providerBlobId: "chunked-provider-blob",
  size,
});

const stream = (...chunks: readonly Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });

describe("JMAP chunked attachment downloads", () => {
  it("accepts an exact metadata-sized body without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(stream(Uint8Array.of(1, 2), Uint8Array.of(3, 4))),
    ));
    const owner = transport();
    const downloaded = await owner.download({
      attachment: attachment(owner, 4),
      messageId: "message-one",
    });

    await expect(new Response(downloaded.body).arrayBuffer())
      .resolves.toHaveProperty("byteLength", 4);
  });

  it("bounds an unknown-size body without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(stream(Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5))),
    ));
    const owner = transport();
    const downloaded = await owner.download({
      attachment: attachment(owner, null),
      messageId: "message-one",
    });

    await expect(new Response(downloaded.body).arrayBuffer()).rejects
      .toMatchObject({ code: "size_limit_exceeded" });
  });

  it("rejects a known Content-Length that disagrees with metadata", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers: { "content-length": "3" },
      }),
    ));
    const owner = transport();

    await expect(owner.download({
      attachment: attachment(owner, 4),
      messageId: "message-one",
    })).rejects.toMatchObject({ code: "content_length_mismatch" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
