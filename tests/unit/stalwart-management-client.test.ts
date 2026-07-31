import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const policyMocks = vi.hoisted(() => ({
  assertSafeProviderOrigin: vi.fn(),
}));

vi.mock("@/infrastructure/providers/stalwart-jmap/provider-url-policy", () => ({
  assertSafeProviderOrigin: policyMocks.assertSafeProviderOrigin,
}));

import {
  StalwartManagementClient,
  StalwartManagementRequestError,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-client";
import { STALWART_JMAP } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const config = {
  apiKey: "api-key-secret",
  baseUrl: "https://mail.example.com/control/path",
  expectedOrigin: "https://mail.example.com",
};
const session = {
  apiUrl: "https://mail.example.com/jmap/",
  capabilities: { [STALWART_JMAP]: {} },
};
const response = {
  methodResponses: [["x:Domain/query", {
    ids: [],
    position: 0,
    queryState: "state",
    total: 0,
  }, "domain"]],
  sessionState: "session-state",
};

beforeEach(() => {
  policyMocks.assertSafeProviderOrigin.mockReset();
  policyMocks.assertSafeProviderOrigin.mockImplementation(
    async (value: string) => new URL(value),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Stalwart management client", () => {
  it("discovers and posts only to the same-origin JMAP API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { location: "/jmap/session" },
          status: 307,
        }),
      )
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);

    await new StalwartManagementClient(config).request([
      ["x:Domain/query", { filter: {} }, "domain"],
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://mail.example.com/.well-known/jmap",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://mail.example.com/jmap/session",
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://mail.example.com/jmap/",
    );
    const request = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(request).toMatchObject({
      cache: "no-store",
      method: "POST",
      redirect: "error",
    });
    expect(request.headers).toMatchObject({
      Authorization: "Bearer api-key-secret",
    });
    expect(String(request.body)).not.toContain("api-key-secret");
    expect(String(request.body)).toContain(STALWART_JMAP);
  });

  it("rejects cross-origin discovered API URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ...session, apiUrl: "https://attacker.example/jmap" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new StalwartManagementClient(config);

    await expect(client.request([])).rejects.toMatchObject({
      ambiguousMutation: false,
      code: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires the Stalwart management capability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ apiUrl: session.apiUrl, capabilities: {} }),
      ),
    );

    await expect(
      new StalwartManagementClient(config).request([]),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("refuses an API-key origin mismatch before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new StalwartManagementClient({
        ...config,
        expectedOrigin: "https://old-mail.example.com",
      }).request([]),
    ).rejects.toMatchObject({
      ambiguousMutation: false,
      code: "configuration",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(policyMocks.assertSafeProviderOrigin).not.toHaveBeenCalled();
  });

  it("bounds management responses to one MiB", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(
        new Response("{}", {
          headers: { "content-length": String(1_024 * 1_024 + 1) },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new StalwartManagementClient(config).request([]),
    ).rejects.toMatchObject({
      ambiguousMutation: false,
      code: "unavailable",
    });
  });

  it("marks issued mutation transport loss as ambiguous", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(session))
      .mockRejectedValueOnce(
        new DOMException("private timeout detail", "TimeoutError"),
      );
    vi.stubGlobal("fetch", fetchMock);

    const failure = await failureFrom(
      new StalwartManagementClient(config).request(
        [["x:Account/set", { create: {} }, "create"]],
        true,
      ),
    );

    expect(failure).toBeInstanceOf(StalwartManagementRequestError);
    expect(failure).toMatchObject({
      ambiguousMutation: true,
      code: "unavailable",
    });
    expect(String(failure)).not.toContain("private timeout detail");
    expect(failure).not.toHaveProperty("cause");
  });

  it.each([408, 500, 502])(
    "marks issued mutation HTTP %s as ambiguous",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(Response.json(session))
          .mockResolvedValueOnce(
            new Response("private provider detail", { status }),
          ),
      );

      const failure = await failureFrom(
        new StalwartManagementClient(config).request(
          [["x:Account/set", { create: {} }, "create"]],
          true,
        ),
      );

      expect(failure).toMatchObject({ ambiguousMutation: true, status });
      expect(String(failure)).not.toContain("private provider detail");
    },
  );

  it("sanitizes provider authentication failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private provider detail api-key-secret", { status: 401 }),
      ),
    );
    const failure = await failureFrom(
      new StalwartManagementClient(config).request([]),
    );

    expect(failure).toMatchObject({
      ambiguousMutation: false,
      code: "auth",
      status: 401,
    });
    expect(String(failure)).not.toContain("api-key-secret");
    expect(failure).not.toHaveProperty("cause");
  });

  it("rejects whitespace-padded API keys before transport", () => {
    expect(
      () =>
        new StalwartManagementClient({
          apiKey: " secret ",
          baseUrl: config.baseUrl,
          expectedOrigin: config.expectedOrigin,
        }),
    ).toThrow(StalwartManagementRequestError);
  });
});

const failureFrom = async (pending: Promise<unknown>): Promise<unknown> => {
  try {
    await pending;
    return null;
  } catch (error) {
    return error;
  }
};
