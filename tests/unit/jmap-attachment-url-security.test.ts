import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => {
    const url = new URL(value);
    if (url.hostname === "blocked.example") throw new Error("blocked");
    return url;
  },
}));

import {
  JmapAttachmentTransport,
  type JmapAttachmentTransportConfig,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";

const baseConfig: JmapAttachmentTransportConfig = {
  authorizationHeader: () => "Bearer provider-secret",
  baseUrl: "https://mail.example.com",
  downloadUrl:
    "https://mail.example.com/download/{accountId}/{blobId}/{name}?type={type}",
  maxDownloadBytes: 1_024,
  maxUploadBytes: 1_024,
  uploadUrl: "https://mail.example.com/upload/{accountId}",
};

const upload = (config: JmapAttachmentTransportConfig, accountId = "account") =>
  new JmapAttachmentTransport(config).upload({
    accountId,
    body: Uint8Array.of(1),
    contentLength: 1,
    fileName: "safe.txt",
    mediaType: "text/plain",
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JMAP attachment endpoint policy", () => {
  it.each([
    {
      label: "cross-origin template",
      patch: { uploadUrl: "https://evil.example/upload/{accountId}" },
    },
    {
      label: "URL credentials",
      patch: {
        uploadUrl:
          "https://provider-user:provider-pass@mail.example.com/upload/{accountId}",
      },
    },
    {
      label: "unknown template operator",
      patch: { uploadUrl: "https://mail.example.com/upload/{+accountId}" },
    },
    {
      label: "duplicate template variable",
      patch: {
        uploadUrl: "https://mail.example.com/upload/{accountId}/{accountId}",
      },
    },
    {
      label: "credential query parameter",
      patch: {
        uploadUrl:
          "https://mail.example.com/upload/{accountId}?access_token=fixed",
      },
    },
    {
      label: "encoded static traversal",
      patch: {
        uploadUrl: "https://mail.example.com/upload/%252e%252e/{accountId}",
      },
    },
  ])("rejects a $label before obtaining credentials", async ({ patch }) => {
    const authorizationHeader = vi.fn(() => "Bearer provider-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      upload({ ...baseConfig, ...patch, authorizationHeader }),
    ).rejects.toMatchObject({ code: "endpoint_rejected" });
    expect(authorizationHeader).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an allowlist-policy failure before credentials or fetch", async () => {
    const authorizationHeader = vi.fn(() => "Bearer provider-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      upload({
        ...baseConfig,
        authorizationHeader,
        baseUrl: "https://blocked.example",
        uploadUrl: "https://blocked.example/upload/{accountId}",
      }),
    ).rejects.toMatchObject({ code: "endpoint_rejected" });
    expect(authorizationHeader).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["..", "%2e%2e", "%252e%252e", "..%2fadmin", "%2fadmin"])(
    "rejects hostile encoded account ID %s",
    async (accountId) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(upload(baseConfig, accountId)).rejects.toMatchObject({
        code: "endpoint_rejected",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects encoded blob traversal in a message download", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new JmapAttachmentTransport(baseConfig);
    const attachment = transport.bindMessageAttachment({
      accountId: "account",
      fileName: "safe.txt",
      mediaType: "text/plain",
      messageId: "message",
      providerBlobId: "%252e%252e",
      size: 1,
    });

    await expect(
      transport.download({ attachment, messageId: "message" }),
    ).rejects.toMatchObject({ code: "endpoint_rejected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow or forward credentials through a cross-origin redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        headers: { location: "https://evil.example/collect" },
        status: 307,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(upload(baseConfig)).rejects.toMatchObject({
      code: "redirect_rejected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      redirect: "manual",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /^https:\/\/mail\.example\.com\//u,
    );
  });
});
