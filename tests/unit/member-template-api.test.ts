import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailTemplateBook } from "@/domain/member/email-template";
import { memberTemplateApi } from "@/transport/client/member-template-api";

const emptyBook: EmailTemplateBook = {
  createdAt: null,
  revision: null,
  templates: [],
  updatedAt: null,
  version: 1,
};
const sessionScope = "test-session-scope";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member template API", () => {
  it("loads the active identity book without browser caching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(memberTemplateApi.get(sessionScope)).resolves.toEqual(
      emptyBook,
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/member/templates",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "x-veda-mail-session-scope": sessionScope,
        }),
        method: "GET",
      }),
    );
  });

  it("passes the exported operation union unchanged", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const operation = {
      content: { body: "Hello", mode: "plain" as const, subject: "Welcome" },
      expectedRevision: null,
      name: "Welcome note",
      operation: "create" as const,
    };

    await memberTemplateApi.put(operation, sessionScope);
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual(operation);
  });

  it("surfaces the safe server error code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "TEMPLATE_BOOK_CONFLICT",
              message: "Templates changed in another session.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(memberTemplateApi.get(sessionScope)).rejects.toMatchObject({
      code: "TEMPLATE_BOOK_CONFLICT",
      message: "Templates changed in another session.",
      status: 409,
    });
  });

  it("preserves an authenticated-session 401 for terminal invalidation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "MEMBER_SESSION_EXPIRED",
              message: "Reconnect this mailbox.",
            },
          },
          { status: 401 },
        ),
      ),
    );

    await expect(memberTemplateApi.get(sessionScope)).rejects.toMatchObject({
      code: "MEMBER_SESSION_EXPIRED",
      message: "Reconnect this mailbox.",
      status: 401,
    });
  });
});
