import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachmentPreviewHeaders,
  createAttachmentPreviewResponse,
} from "@/server/mail/attachment-preview-http";

const prepared = (value = "safe preview") => {
  const bytes = new TextEncoder().encode(value);
  return {
    bytes,
    dispose: vi.fn(() => bytes.fill(0)),
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("attachment preview HTTP response", () => {
  it("prevents transformation and releases bytes after complete delivery", async () => {
    const preview = prepared();
    const response = createAttachmentPreviewResponse(preview);

    expect(attachmentPreviewHeaders().get("cache-control")).toBe(
      "private, no-store, no-transform, max-age=0",
    );
    await expect(response.text()).resolves.toBe("safe preview");
    expect(preview.dispose).toHaveBeenCalledOnce();
    expect(preview.bytes.every((value) => value === 0)).toBe(true);
  });

  it("errors an unconsumed response and releases its lease at the deadline", async () => {
    vi.useFakeTimers();
    const preview = prepared();
    const response = createAttachmentPreviewResponse(preview, undefined, 20);

    expect(preview.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);

    expect(preview.dispose).toHaveBeenCalledOnce();
    await expect(response.text()).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_RESPONSE_TIMEOUT",
      status: 504,
    });
  });

  it("releases exactly once on cancellation or request abort", async () => {
    const cancelled = prepared();
    const cancelledResponse = createAttachmentPreviewResponse(cancelled);
    await cancelledResponse.body?.cancel();
    expect(cancelled.dispose).toHaveBeenCalledOnce();

    const controller = new AbortController();
    const aborted = prepared();
    const abortedResponse = createAttachmentPreviewResponse(
      aborted,
      controller.signal,
    );
    controller.abort();
    expect(aborted.dispose).toHaveBeenCalledOnce();
    await expect(abortedResponse.text()).rejects.toMatchObject({
      code: "ATTACHMENT_PREVIEW_ABORTED",
      status: 499,
    });
  });

  it("disposes before rejecting an invalid response deadline", () => {
    const preview = prepared();

    expect(() =>
      createAttachmentPreviewResponse(preview, undefined, 0),
    ).toThrow(RangeError);
    expect(preview.dispose).toHaveBeenCalledOnce();
  });
});
