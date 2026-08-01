import { afterEach, describe, expect, it, vi } from "vitest";

import { attachmentApi } from "@/transport/client/attachment-api";

const sessionScope = "test-session-scope";

afterEach(() => vi.unstubAllGlobals());

describe("attachment archive ticket client", () => {
  it("exchanges the session header for a short-lived opaque ticket", async () => {
    const signal = new AbortController().signal;
    const ticket = "t".repeat(43);
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          data: {
            expiresAt: "2099-01-01T00:00:00.000Z",
            ticket,
          },
        },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachmentApi.preflightAttachmentArchive(
        "/api/v1/mail/messages/message/attachments/archive",
        sessionScope,
        signal,
      ),
    ).resolves.toBe(
      `/api/v1/mail/messages/message/attachments/archive?ticket=${ticket}`,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/messages/message/attachments/archive",
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-veda-mail-session-scope": sessionScope },
        method: "POST",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      },
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(sessionScope);
  });

  it("rejects a malformed ticket before starting a native download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: { ticket: "not safe?" } })),
    );

    await expect(
      attachmentApi.preflightAttachmentArchive("/archive", sessionScope),
    ).rejects.toThrow("archive ticket is invalid");
  });
});
