import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  JMAP_CORE,
  JMAP_MAIL,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const config = {
  authType: "basic" as const,
  baseUrl: "https://mail.example.com",
  secret: "secret",
  username: "user@example.com",
};

const session = {
  accounts: { account: { isReadOnly: false, name: "User" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: { [JMAP_CORE]: { maxSizeUpload: 50_000_000 } },
  downloadUrl: "https://mail.example.com/download",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "user@example.com",
};

const streamingError = (
  status: number,
  cancel: () => void,
): Response =>
  new Response(new ReadableStream({ cancel }), {
    status,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart HTTP error body cancellation", () => {
  it("cancels an unread discovery error body before rejecting", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamingError(503, cancel)),
    );

    await expect(
      new StalwartJmapClient(config).getSession(),
    ).rejects.toMatchObject({ status: 503 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels an unread final API error body before rejecting", async () => {
    const cancel = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(streamingError(500, cancel));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new StalwartJmapClient(config).request([], [JMAP_MAIL]),
    ).rejects.toMatchObject({ status: 500 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
