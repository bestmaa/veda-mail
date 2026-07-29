import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import {
  JmapAttachmentTransport,
  type JmapAttachmentTransportConfig,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";

const config: JmapAttachmentTransportConfig = {
  authorizationHeader: () => "Bearer provider-secret",
  baseUrl: "https://mail.example.com",
  downloadUrl:
    "https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}",
  maxDownloadBytes: 1_024,
  maxUploadBytes: 1_024,
  operationTimeoutMs: 15,
  uploadUrl: "https://mail.example.com/upload/{accountId}",
};

const uploadInput = (body: Uint8Array | ReadableStream<Uint8Array>) => ({
  accountId: "account",
  body,
  contentLength: 1,
  fileName: "safe.txt",
  mediaType: "text/plain",
});

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JMAP attachment resilience", () => {
  it("does not allow the mandatory timeout to exceed five minutes", () => {
    expect(
      () =>
        new JmapAttachmentTransport({
          ...config,
          operationTimeoutMs: 300_001,
        }),
    ).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects a provider-returned MIME type that differs from the upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          accountId: "account",
          blobId: "providerBlob",
          size: 1,
          type: "text/html",
        }),
      ),
    );

    await expect(
      new JmapAttachmentTransport(config).upload(uploadInput(Uint8Array.of(1))),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("maps an already-locked upload stream to a structured input error", async () => {
    const stream = new ReadableStream<Uint8Array>();
    const reader = stream.getReader();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(
        new JmapAttachmentTransport(config).upload(uploadInput(stream)),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      reader.releaseLock();
    }
  });

  it("times out a provider fetch that ignores the merged signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    await expect(
      new JmapAttachmentTransport(config).upload(uploadInput(Uint8Array.of(1))),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("times out and cancels a stalled upload source", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: URL, init?: RequestInit) => {
        await new Response(init?.body ?? null).arrayBuffer();
        return jsonResponse({
          accountId: "account",
          blobId: "providerBlob",
          size: 1,
          type: "text/plain",
        });
      }),
    );

    await expect(
      new JmapAttachmentTransport(config).upload(uploadInput(source)),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("times out and cancels a stalled download body", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-length": "1" },
        }),
      ),
    );
    const transport = new JmapAttachmentTransport(config);
    const attachment = transport.bindMessageAttachment({
      accountId: "account",
      fileName: "safe.txt",
      mediaType: "text/plain",
      messageId: "message",
      providerBlobId: "providerBlob",
      size: 1,
    });

    const downloaded = await transport.download({
      attachment,
      messageId: "message",
    });
    await expect(
      new Response(downloaded.body).arrayBuffer(),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("encodes a literal percent-looking filename once per RFC6570", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Uint8Array.of(1), {
        headers: { "content-length": "1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(config);
    const attachment = transport.bindMessageAttachment({
      accountId: "account",
      fileName: "100%2F-complete!.txt",
      mediaType: "text/plain",
      messageId: "message",
      providerBlobId: "providerBlob",
      size: 1,
    });

    const downloaded = await transport.download({
      attachment,
      messageId: "message",
    });
    await new Response(downloaded.body).arrayBuffer();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://mail.example.com/download/account/providerBlob/" +
        "100%252F-complete%21.txt?type=text%2Fplain",
    );
  });
});
