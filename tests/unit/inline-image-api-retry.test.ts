import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchInlineImage,
  INLINE_IMAGE_MAX_ATTEMPTS,
} from "@/transport/client/inline-image-api";

const href =
  "/api/v1/mail/messages/message/attachments/attachment/inline-image";

const failureResponse = (
  status: number,
  message: string,
  retryAfter?: string,
  code?: string,
): Response =>
  new Response(JSON.stringify({ error: { code, message } }), {
    headers: {
      "content-type": "application/json",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
    status,
  });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("inline image client retry policy", () => {
  it("retries bounded busy and unavailable responses", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        failureResponse(429, "Busy.", "0", "INLINE_IMAGE_BUSY"),
      )
      .mockResolvedValueOnce(failureResponse(503, "Scanner unavailable."))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-length": "3",
            "content-type": "image/webp",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchInlineImage(href);
    await vi.runAllTimersAsync();
    const blob = await result;

    expect(fetchMock).toHaveBeenCalledTimes(INLINE_IMAGE_MAX_ATTEMPTS);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("stops after the retry budget and preserves the final safe error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      failureResponse(503, "Image processing is temporarily unavailable."),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(fetchInlineImage(href)).rejects.toThrow(
      "Image processing is temporarily unavailable.",
    );
    await vi.runAllTimersAsync();

    await result;
    expect(fetchMock).toHaveBeenCalledTimes(INLINE_IMAGE_MAX_ATTEMPTS);
  });

  it("uses a safe Retry-After date as a minimum retry delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        failureResponse(
          429,
          "Busy.",
          new Date("2026-01-01T00:00:01.000Z").toUTCString(),
          "INLINE_IMAGE_BUSY",
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([7]), {
          headers: {
            "content-length": "1",
            "content-type": "image/webp",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchInlineImage(href);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    expect((await result).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent failures or excessive backoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failureResponse(401, "Sign in again."))
      .mockResolvedValueOnce(failureResponse(415, "Unsupported image."))
      .mockResolvedValueOnce(
        failureResponse(
          429,
          "Try much later.",
          "120",
          "INLINE_IMAGE_BUSY",
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchInlineImage(href)).rejects.toThrow("Sign in again.");
    await expect(fetchInlineImage(href)).rejects.toThrow("Unsupported image.");
    await expect(fetchInlineImage(href)).rejects.toThrow("Try much later.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not amplify fixed-window or unclassified 429 responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        failureResponse(
          429,
          "Too many requests.",
          undefined,
          "RATE_LIMITED",
        ),
      )
      .mockResolvedValueOnce(failureResponse(429, "Please wait."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchInlineImage(href)).rejects.toThrow(
      "Too many requests.",
    );
    await expect(fetchInlineImage(href)).rejects.toThrow("Please wait.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts during retry backoff without another request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      failureResponse(503, "Scanner unavailable."),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = fetchInlineImage(href, controller.signal).catch(
      (error: unknown) => error,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort();

    await expect(result).resolves.toMatchObject({ name: "AbortError" });
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
