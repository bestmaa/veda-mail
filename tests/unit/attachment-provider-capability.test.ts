import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderHost: async () => undefined,
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { id } from "@/domain/shared/brand";
import {
  JMAP_CORE,
  JMAP_MAIL,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { maximumJmapUploadBytes } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import {
  assertAttachmentCapability,
  resolveAttachmentCapability,
} from "@/server/mail/attachment-service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dynamic attachment provider capability", () => {
  it("uses the JMAP session upload limit before reserving a file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        accounts: { account: { isReadOnly: false, name: "User" } },
        apiUrl: "https://mail.example.com/jmap",
        capabilities: { [JMAP_CORE]: { maxSizeUpload: 1_024 } },
        downloadUrl: "https://mail.example.com/download",
        primaryAccounts: { [JMAP_MAIL]: "account" },
        uploadUrl: "https://mail.example.com/upload",
        username: "user@example.com",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const connection = {
      config: {
        authType: "basic",
        baseUrl: "https://mail.example.com",
        secret: "secret",
        username: "user@example.com",
      },
      createdAt: new Date().toISOString(),
      displayName: "Stalwart",
      id: id.connection(`capability-${crypto.randomUUID()}`),
      providerId: id.provider("stalwart-jmap"),
    };

    await expect(resolveAttachmentCapability(connection)).resolves.toBe(1_024);
    await expect(
      assertAttachmentCapability(connection, 1_025),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_TOO_LARGE",
      status: 413,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed for missing or malformed mandatory JMAP limits", () => {
    const session = {
      accounts: {},
      apiUrl: "https://mail.example.com/jmap",
      capabilities: {},
      downloadUrl: "https://mail.example.com/download",
      primaryAccounts: {},
      uploadUrl: "https://mail.example.com/upload",
      username: "user@example.com",
    };

    expect(() => maximumJmapUploadBytes(session)).toThrow("invalid JMAP");
    expect(() =>
      maximumJmapUploadBytes({
        ...session,
        capabilities: { [JMAP_CORE]: { maxSizeUpload: "1024" } },
      }),
    ).toThrow("invalid JMAP");
  });

  it("disables zero-sized uploads and clamps oversized provider limits", () => {
    const session = {
      accounts: {},
      apiUrl: "https://mail.example.com/jmap",
      capabilities: { [JMAP_CORE]: { maxSizeUpload: 0 } },
      downloadUrl: "https://mail.example.com/download",
      primaryAccounts: {},
      uploadUrl: "https://mail.example.com/upload",
      username: "user@example.com",
    };

    expect(maximumJmapUploadBytes(session)).toBe(0);
    expect(
      maximumJmapUploadBytes({
        ...session,
        capabilities: {
          [JMAP_CORE]: { maxSizeUpload: Number.MAX_SAFE_INTEGER },
        },
      }),
    ).toBe(18 * 1024 * 1024);
  });
});
