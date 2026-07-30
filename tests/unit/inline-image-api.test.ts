import { afterEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import {
  createInlineImageHref,
  fetchInlineImage,
  INLINE_IMAGE_CLIENT_MAX_BYTES,
} from "@/transport/client/inline-image-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const href = "/api/v1/mail/messages/message/attachments/attachment/inline-image";

describe("inline image client API", () => {
  it("builds an encoded message-scoped route and fetches exact bounded WebP", async () => {
    const href = createInlineImageHref(
      id.message("message/opaque"),
      id.attachment("attachment?opaque"),
    );
    expect(href).toBe(
      "/api/v1/mail/messages/message%2Fopaque/attachments/attachment%3Fopaque/inline-image",
    );
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "content-length": "3",
          "content-type": "image/webp",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await fetchInlineImage(href, signal);

    expect(blob.type).toBe("image/webp");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fetchMock).toHaveBeenCalledWith(href, {
      body: JSON.stringify({ renderer: "inline-image" }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "image/webp",
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  });

  it("rejects external paths, unsafe types, and invalid declared sizes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchInlineImage("https://evil.example/tracker.webp"),
    ).rejects.toThrow("reference is invalid");
    expect(fetchMock).not.toHaveBeenCalled();

    const unsafeTypeCancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new ReadableStream({ cancel: unsafeTypeCancel }), {
          headers: {
            "content-length": "20",
            "content-type": "image/svg+xml",
          },
        }),
      ),
    );
    await expect(
      fetchInlineImage(href),
    ).rejects.toThrow("unsafe type");
    expect(unsafeTypeCancel).toHaveBeenCalledOnce();

    const unsafeLengthCancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new ReadableStream({ cancel: unsafeLengthCancel }), {
          headers: {
            "content-length": String(INLINE_IMAGE_CLIENT_MAX_BYTES + 1),
            "content-type": "image/webp",
          },
        }),
      ),
    );
    await expect(
      fetchInlineImage(href),
    ).rejects.toThrow("invalid size");
    expect(unsafeLengthCancel).toHaveBeenCalledOnce();
  });

  it("rejects truncated and overlong streams despite trusted headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2]), {
          headers: {
            "content-length": "3",
            "content-type": "image/webp",
          },
        }),
      ),
    );
    await expect(
      fetchInlineImage(href),
    ).rejects.toThrow("incomplete");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: {
            "content-length": "3",
            "content-type": "image/webp",
          },
        }),
      ),
    );
    await expect(
      fetchInlineImage(href),
    ).rejects.toThrow("exceeded its safe size");
  });

});
