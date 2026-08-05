import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: async (value: string) => new URL(value),
}));

import {
  getStalwartMailUpdateMode,
  waitForStalwartMailUpdate,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-mail-update";
import { JMAP_CORE, JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const session = {
  accounts: { account: { isReadOnly: false, name: "User" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: { [JMAP_CORE]: { maxSizeUpload: 50_000_000 } },
  downloadUrl: "https://mail.example.com/download",
  eventSourceUrl: "https://mail.example.com/events?types={types}&closeafter={closeafter}&ping={ping}",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "user@example.com",
};
const client = (eventSourceUrl = session.eventSourceUrl) => ({
  authorizationForProviderTransport: async () => "Basic secret",
  getSession: async () => ({ ...session, eventSourceUrl }),
});

afterEach(() => vi.unstubAllGlobals());

describe("Stalwart mail updates", () => {
  it("consumes one same-origin JMAP state event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      "event: state\ndata: {\"changed\":{\"account\":{\"Email\":\"next\"}}}\n\n",
      { headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getStalwartMailUpdateMode(client(), "https://mail.example.com"))
      .resolves.toBe("push");
    await expect(waitForStalwartMailUpdate(client(), "https://mail.example.com"))
      .resolves.toEqual({
        mode: "push", retryAfterMs: 1_000, shouldRefresh: true,
      });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://mail.example.com/events?types=Email%2CMailbox&closeafter=state&ping=30",
    );
  });

  it("falls back to polling for a cross-origin event source", async () => {
    const untrusted = client("https://attacker.example/events?types={types}");

    await expect(getStalwartMailUpdateMode(untrusted, "https://mail.example.com"))
      .resolves.toBe("poll");
    await expect(waitForStalwartMailUpdate(untrusted, "https://mail.example.com"))
      .resolves.toEqual({
        mode: "poll", retryAfterMs: 60_000, shouldRefresh: true,
      });
  });
});
