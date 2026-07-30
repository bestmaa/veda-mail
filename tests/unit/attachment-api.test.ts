import { afterEach, describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { attachmentApi } from "@/transport/client/attachment-api";

const upload = {
  expiresAt: "2099-01-01T00:00:00.000Z",
  id: id.attachmentUpload("q".repeat(32)),
  mimeType: "application/pdf",
  name: "roadmap.pdf",
  size: 51,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachment client API", () => {
  it("requests plain text preview only through an explicit bounded POST", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn(async () =>
      new Response("safe text", {
        headers: {
          "content-length": "9",
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachmentApi.previewAttachment(
        "/api/v1/mail/messages/message/attachments/attachment/preview",
        signal,
      ),
    ).resolves.toBe("safe text");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/messages/message/attachments/attachment/preview",
      {
        body: JSON.stringify({ renderer: "text" }),
        cache: "no-store",
        headers: {
          Accept: "text/plain",
          "Content-Type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
  });

  it("rejects untrusted preview response types and lengths", async () => {
    const unsafeTypeCancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({ cancel: unsafeTypeCancel }),
          {
          headers: {
            "content-length": "25",
            "content-type": "text/html; charset=utf-8",
          },
          },
        ),
      ),
    );
    await expect(
      attachmentApi.previewAttachment("/preview"),
    ).rejects.toThrow("unsafe type");
    expect(unsafeTypeCancel).toHaveBeenCalledOnce();

    const unsafeLengthCancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({ cancel: unsafeLengthCancel }),
          {
          headers: {
            "content-length": "1048577",
            "content-type": "text/plain; charset=utf-8",
          },
          },
        ),
      ),
    );
    await expect(
      attachmentApi.previewAttachment("/preview"),
    ).rejects.toThrow("invalid size");
    expect(unsafeLengthCancel).toHaveBeenCalledOnce();
  });

  it("imports by opaque route IDs with only the server-bound draft ID", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn<
      (input: string, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({ data: upload }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachmentApi.importAttachment(
        id.draft("4ec09418-1b33-4d57-97c4-f2858fbcbca1"),
        id.message("message/opaque"),
        id.attachment("attachment?opaque"),
        signal,
      ),
    ).resolves.toEqual(upload);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/messages/message%2Fopaque/attachments/attachment%3Fopaque/imports",
      {
        body: JSON.stringify({
          draftId: "4ec09418-1b33-4d57-97c4-f2858fbcbca1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal,
      },
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      draftId: "4ec09418-1b33-4d57-97c4-f2858fbcbca1",
    });
  });

  it("surfaces the server's actionable import rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message: "Forwarded attachments cannot exceed 18 MiB.",
            },
          },
          { status: 413 },
        ),
      ),
    );

    await expect(
      attachmentApi.importAttachment(
        id.draft("4ec09418-1b33-4d57-97c4-f2858fbcbca1"),
        id.message("message"),
        id.attachment("attachment"),
      ),
    ).rejects.toThrow("Forwarded attachments cannot exceed 18 MiB.");
  });
});
