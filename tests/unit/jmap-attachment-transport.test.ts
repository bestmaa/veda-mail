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
  uploadUrl: "https://mail.example.com/upload/{accountId}",
};

const jsonResponse = (value: unknown): Response => {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/json",
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JMAP attachment upload transport", () => {
  it("uploads raw bytes with an exact length and hides the provider blob ID", async () => {
    const fetchMock = vi.fn(
      async (
        url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        expect(String(url)).toBe("https://mail.example.com/upload/team_west");
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        expect(init?.credentials).toBe("omit");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer provider-secret",
          "Content-Length": "4",
          "Content-Type": "text/plain",
        });
        expect(Array.from(new Uint8Array(init?.body as ArrayBuffer))).toEqual([
          1, 2, 3, 4,
        ]);
        return jsonResponse({
          accountId: "team_west",
          blobId: "jmap-provider-blob",
          size: 4,
          type: "text/plain",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(config);

    const attachment = await transport.upload({
      accountId: "team_west",
      body: Uint8Array.of(1, 2, 3, 4),
      contentLength: 4,
      fileName: "notes.txt",
      mediaType: "text/plain",
    });

    expect(attachment).toMatchObject({
      fileName: "notes.txt",
      mediaType: "text/plain",
      size: 4,
    });
    expect(attachment.attachmentId).toMatch(
      /^attachment_[0-9a-f]{8}-[0-9a-f-]{27}$/u,
    );
    expect(JSON.stringify(attachment)).not.toContain("jmap-provider-blob");
    expect(transport.providerUploadReference(attachment)).toEqual({
      blobId: "jmap-provider-blob",
      size: 4,
      type: "text/plain",
    });
  });

  it("streams exact raw bytes and rejects a truncated stream", async () => {
    const received: number[][] = [];
    const fetchMock = vi.fn(
      async (
        _url: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const bytes = new Uint8Array(
          await new Response(init?.body ?? null).arrayBuffer(),
        );
        received.push(Array.from(bytes));
        return jsonResponse({
          accountId: "account",
          blobId: "blob",
          size: 4,
          type: "application/octet-stream",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(config);
    const exact = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2));
        controller.enqueue(Uint8Array.of(3, 4));
        controller.close();
      },
    });

    await expect(
      transport.upload({
        accountId: "account",
        body: exact,
        contentLength: 4,
        fileName: "bytes.bin",
        mediaType: "application/octet-stream",
      }),
    ).resolves.toMatchObject({ size: 4 });
    expect(received).toEqual([[1, 2, 3, 4]]);

    const truncated = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.of(1, 2, 3));
        controller.close();
      },
    });
    await expect(
      transport.upload({
        accountId: "account",
        body: truncated,
        contentLength: 4,
        fileName: "bytes.bin",
        mediaType: "application/octet-stream",
      }),
    ).rejects.toMatchObject({ code: "content_length_mismatch" });
  });

  it("rejects oversized and mismatched byte bodies before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport({
      ...config,
      maxUploadBytes: 3,
    });
    await expect(
      transport.upload({
        accountId: "account",
        body: Uint8Array.of(1, 2, 3, 4),
        contentLength: 4,
        fileName: "bytes.bin",
        mediaType: "application/octet-stream",
      }),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
    await expect(
      new JmapAttachmentTransport(config).upload({
        accountId: "account",
        body: Uint8Array.of(1, 2, 3),
        contentLength: 4,
        fileName: "bytes.bin",
        mediaType: "application/octet-stream",
      }),
    ).rejects.toMatchObject({ code: "content_length_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
