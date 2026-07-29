import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import {
  JmapAttachmentTransport,
  JmapAttachmentTransportError,
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

const messageAttachment = (transport: JmapAttachmentTransport) =>
  transport.bindMessageAttachment({
    accountId: "account-one",
    fileName: "quarterly report.pdf",
    mediaType: "application/pdf",
    messageId: "message-one",
    providerBlobId: "provider-blob-secret",
    size: 4,
  });

const readBytes = async (
  body: ReadableStream<Uint8Array>,
): Promise<Uint8Array> =>
  new Uint8Array(await new Response(body).arrayBuffer());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JMAP attachment download transport", () => {
  it("downloads only a message-scoped handle with exact bytes", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://mail.example.com/download/account-one/" +
            "provider-blob-secret/quarterly%20report.pdf?type=application%2Fpdf",
        );
        expect(init?.headers).toMatchObject({
          Accept: "application/pdf",
          Authorization: "Bearer provider-secret",
        });
        return new Response(Uint8Array.of(1, 2, 3, 4), {
          headers: { "content-length": "4" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(config);
    const attachment = messageAttachment(transport);
    expect(attachment.attachmentId).not.toBe("provider-blob-secret");
    expect(JSON.stringify(attachment)).not.toContain("provider-blob-secret");

    const downloaded = await transport.download({
      attachment,
      messageId: "message-one",
    });

    expect(Array.from(await readBytes(downloaded.body))).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(downloaded)).not.toContain("provider-blob-secret");
    await expect(
      transport.download({ attachment, messageId: "another-message" }),
    ).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      body: Uint8Array.of(1, 2, 3),
      contentLength: "4",
      expectedCode: "content_length_mismatch",
      label: "truncated",
    },
    {
      body: Uint8Array.of(1, 2, 3, 4, 5),
      contentLength: "4",
      expectedCode: "content_length_mismatch",
      label: "longer-than-declared",
    },
  ])(
    "rejects a $label provider body",
    async ({ body, contentLength, expectedCode }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(body, {
            headers: { "content-length": contentLength },
          }),
        ),
      );
      const transport = new JmapAttachmentTransport(config);
      const downloaded = await transport.download({
        attachment: messageAttachment(transport),
        messageId: "message-one",
      });
      await expect(readBytes(downloaded.body)).rejects.toMatchObject({
        code: expectedCode,
      });
    },
  );

  it("rejects a declared response larger than the configured limit", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-length": "2048" },
        }),
      ),
    );
    const transport = new JmapAttachmentTransport(config);
    await expect(
      transport.download({
        attachment: messageAttachment(transport),
        messageId: "message-one",
      }),
    ).rejects.toMatchObject({ code: "size_limit_exceeded" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a provider content encoding that could invalidate byte limits", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: {
            "content-encoding": "gzip",
            "content-length": "4",
          },
        }),
      ),
    );
    const transport = new JmapAttachmentTransport(config);

    await expect(
      transport.download({
        attachment: messageAttachment(transport),
        messageId: "message-one",
      }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the provider stream when the browser stops downloading", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { "content-length": "4" },
        }),
      ),
    );
    const transport = new JmapAttachmentTransport(config);
    const downloaded = await transport.download({
      attachment: messageAttachment(transport),
      messageId: "message-one",
    });

    await downloaded.body.cancel("browser closed");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a handle bound to another transport instance", async () => {
    const owner = new JmapAttachmentTransport(config);
    const other = new JmapAttachmentTransport(config);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      other.download({
        attachment: messageAttachment(owner),
        messageId: "message-one",
      }),
    ).rejects.toMatchObject({ code: "invalid_handle" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts while waiting for provider body bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { "content-length": "4" },
        }),
      ),
    );
    const controller = new AbortController();
    const transport = new JmapAttachmentTransport(config);
    const operation = transport.download({
      attachment: messageAttachment(transport),
      messageId: "message-one",
      signal: controller.signal,
    });
    const downloaded = await operation;
    const bytes = readBytes(downloaded.body);
    queueMicrotask(() => controller.abort());
    await expect(bytes).rejects.toMatchObject({ code: "aborted" });
  });

  it("normalizes AbortSignal cancellation into a structured error", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(config);

    const operation = transport.download({
      attachment: messageAttachment(transport),
      messageId: "message-one",
      signal: controller.signal,
    });

    await expect(operation).rejects.toBeInstanceOf(
      JmapAttachmentTransportError,
    );
    await expect(operation).rejects.toMatchObject({ code: "aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
