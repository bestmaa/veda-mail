import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "@/infrastructure/providers/stalwart-jmap/provider-url-policy",
  () => ({
    assertSafeProviderOrigin: async (value: string) => new URL(value),
  }),
);

import { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { jmapSetResultSchema } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const config = {
  authType: "basic" as const,
  baseUrl: "https://mail.example.com",
  secret: "secret",
  username: "user@example.com",
};

const session = {
  accounts: { account: { isReadOnly: false, name: "User" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: {},
  downloadUrl: "https://mail.example.com/download",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "user@example.com",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart JMAP client", () => {
  it("follows a same-origin discovery redirect", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: "/jmap/session" },
          status: 307,
        }),
      )
      .mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new StalwartJmapClient(config).getSession()).resolves.toEqual(
      session,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://mail.example.com/jmap/session",
    );
  });

  it("rejects a cross-origin discovery redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          headers: { location: "https://attacker.example/jmap" },
          status: 307,
        }),
      ),
    );

    await expect(
      new StalwartJmapClient(config).getSession(),
    ).rejects.toThrow("cross-origin");
  });

  it("rejects malformed session JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ apiUrl: 42 })),
    );

    await expect(
      new StalwartJmapClient(config).getSession(),
    ).rejects.toThrow("invalid JMAP session");
  });

  it("rejects malformed JMAP response envelopes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json({ methodResponses: "invalid" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new StalwartJmapClient(config).request([], [JMAP_MAIL]),
    ).rejects.toThrow("invalid JMAP response");
  });

  it("rejects malformed method payloads", () => {
    const response = {
      methodResponses: [
        ["Email/set", { created: { draft: { id: 42 } } }, "create"],
      ] as const,
      sessionState: "state",
    };

    expect(() =>
      new StalwartJmapClient(config).result(
        response,
        "create",
        "Email/set",
        jmapSetResultSchema,
      ),
    ).toThrow("invalid Email/set payload");
  });
});
