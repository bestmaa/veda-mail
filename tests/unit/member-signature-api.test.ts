import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailSignatureBook } from "@/domain/member/email-signature";
import { memberSignatureApi } from "@/transport/client/member-signature-api";

const emptyBook: EmailSignatureBook = {
  createdAt: null,
  defaults: { newMessageId: null, replyForwardId: null },
  revision: null,
  signatures: [],
  updatedAt: null,
  version: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("member signature API", () => {
  it("loads the active identity book without browser caching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: emptyBook }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(memberSignatureApi.get()).resolves.toEqual(emptyBook);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/member/signatures",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
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
      content: { body: "Ada", mode: "plain" as const },
      expectedRevision: null,
      name: "Work",
      operation: "create" as const,
    };

    await memberSignatureApi.put(operation);
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
              code: "SIGNATURE_REVISION_CONFLICT",
              message: "Signature settings changed.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    await expect(memberSignatureApi.get()).rejects.toMatchObject({
      code: "SIGNATURE_REVISION_CONFLICT",
      message: "Signature settings changed.",
      status: 409,
    });
  });
});
