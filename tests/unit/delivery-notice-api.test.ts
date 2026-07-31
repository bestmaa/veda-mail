import { afterEach, describe, expect, it, vi } from "vitest";

import { deliveryNoticeApi } from "@/transport/client/delivery-notice-api";

const noticeId = "00000000-0000-4000-8000-000000000001";
const sessionScope = "test-session-scope";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("delivery notice client API", () => {
  it("loads same-origin uncached snapshots and returns only the notice payload", async () => {
    const notices = [
      {
        deliveryNoticeId: noticeId,
        kind: "uncertain",
        submittedAt: "2026-07-30T12:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { notices } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(
      deliveryNoticeApi.list(sessionScope, signal),
    ).resolves.toEqual(notices);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/delivery-notices",
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "x-veda-mail-session-scope": sessionScope,
        },
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      },
    );
  });

  it("dismisses an exact opaque id with no browser-stored recipient data", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await deliveryNoticeApi.dismiss(noticeId, sessionScope, signal);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/mail/delivery-notices/${noticeId}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "x-veda-mail-session-scope": sessionScope,
        },
        method: "DELETE",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      },
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("@");
  });

  it("rejects malformed ids before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deliveryNoticeApi.dismiss("../../other-account", sessionScope),
    ).rejects.toThrow("reference is invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces bounded API failures and rejects oversized snapshots", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "MEMBER_SESSION_EXPIRED",
                message: "Sign in again.",
              },
            },
            { status: 401 },
          ),
        )
        .mockResolvedValueOnce(
          new Response("{}", {
            headers: { "content-length": String(4 * 1024 * 1024 + 1) },
          }),
        ),
    );

    await expect(deliveryNoticeApi.list(sessionScope)).rejects.toMatchObject({
      code: "MEMBER_SESSION_EXPIRED",
      message: "Sign in again.",
      status: 401,
    });
    await expect(deliveryNoticeApi.list(sessionScope)).rejects.toThrow(
      "response was too large",
    );
  });
});
