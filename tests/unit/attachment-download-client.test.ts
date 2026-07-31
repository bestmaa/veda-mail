import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
import { saveAttachmentResponse } from "@/transport/client/attachment-download-client";

interface BrowserDownloadFixture {
  readonly anchor: {
    click: ReturnType<typeof vi.fn>;
    download: string;
    hidden: boolean;
    href: string;
    remove: ReturnType<typeof vi.fn>;
  };
  readonly append: ReturnType<typeof vi.fn>;
  readonly createObjectURL: ReturnType<typeof vi.fn>;
  readonly revokeObjectURL: ReturnType<typeof vi.fn>;
  readonly setTimeout: ReturnType<typeof vi.fn>;
}

interface BrowserDownloadFixtureOptions {
  readonly clickError?: Error;
  readonly createElementError?: Error;
  readonly removeError?: Error;
  readonly setTimeoutError?: Error;
}

const installBrowserDownloadFixture = (
  options: BrowserDownloadFixtureOptions = {},
): BrowserDownloadFixture => {
  const anchor = {
    click: vi.fn(() => {
      if (options.clickError) throw options.clickError;
    }),
    download: "",
    hidden: false,
    href: "",
    remove: vi.fn(() => {
      if (options.removeError) throw options.removeError;
    }),
  };
  const append = vi.fn();
  const createObjectURL = vi.fn(() => "blob:attachment-download");
  const revokeObjectURL = vi.fn();
  const setTimeout = vi.fn(() => {
    if (options.setTimeoutError) throw options.setTimeoutError;
    return 1;
  });
  vi.stubGlobal("document", {
    body: { append },
    createElement: vi.fn(() => {
      if (options.createElementError) throw options.createElementError;
      return anchor;
    }),
  });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("window", { setTimeout });
  return {
    anchor,
    append,
    createObjectURL,
    revokeObjectURL,
    setTimeout,
  };
};

const responseWith = (
  body: BodyInit | null,
  contentLength?: string,
): Response =>
  new Response(body, {
    ...(contentLength ? { headers: { "content-length": contentLength } } : {}),
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachment download client", () => {
  it("hands bounded bytes to the browser and revokes the object URL", async () => {
    const browser = installBrowserDownloadFixture();
    const response = responseWith(new Uint8Array([1, 2, 3]), "3");

    await saveAttachmentResponse(response, '../report\r\n".pdf');

    expect(browser.append).toHaveBeenCalledWith(browser.anchor);
    expect(browser.anchor.click).toHaveBeenCalledOnce();
    expect(browser.anchor.remove).toHaveBeenCalledOnce();
    expect(browser.anchor.download).not.toMatch(/[\\/\r\n]/u);
    expect(browser.anchor.href).toBe("blob:attachment-download");
    const blob = browser.createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(blob.type).toBe("application/octet-stream");
    expect(browser.setTimeout).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(browser.revokeObjectURL).not.toHaveBeenCalled();
    const revoke = browser.setTimeout.mock.calls[0]?.[0] as () => void;
    revoke();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith(
      "blob:attachment-download",
    );
  });

  it.each([
    ["invalid", "not-a-size", "invalid size"],
    [
      "oversized",
      String(MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES + 1),
      "safe download size",
    ],
  ])("cancels a body with an %s declared length", async (_case, length, message) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    installBrowserDownloadFixture();

    await expect(
      saveAttachmentResponse(responseWith(body, length), "unsafe.bin"),
    ).rejects.toThrow(message);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects and cancels bytes that exceed the declared length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    installBrowserDownloadFixture();

    await expect(
      saveAttachmentResponse(responseWith(body, "1"), "overflow.bin"),
    ).rejects.toThrow("exceeded its declared safe size");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not wait for a hostile body's cancellation to settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ cancel });
    installBrowserDownloadFixture();

    await expect(
      saveAttachmentResponse(responseWith(body, "invalid"), "unsafe.bin"),
    ).rejects.toThrow("invalid size");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not wait for overflowing-stream cancellation to settle", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    installBrowserDownloadFixture();

    await expect(
      saveAttachmentResponse(responseWith(body, "1"), "overflow.bin"),
    ).rejects.toThrow("exceeded its declared safe size");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a truncated response before creating a browser download", async () => {
    const browser = installBrowserDownloadFixture();

    await expect(
      saveAttachmentResponse(
        responseWith(new Uint8Array([1, 2]), "3"),
        "truncated.bin",
      ),
    ).rejects.toThrow("download was incomplete");
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(browser.anchor.click).not.toHaveBeenCalled();
  });

  it("rejects missing or failed bodies before browser handoff", async () => {
    const browser = installBrowserDownloadFixture();
    await expect(
      saveAttachmentResponse(responseWith(null, "1"), "missing.bin"),
    ).rejects.toThrow("returned no content");
    const failed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("Provider stream failed."));
      },
    });
    await expect(
      saveAttachmentResponse(responseWith(failed), "failed.bin"),
    ).rejects.toThrow("Provider stream failed");
    expect(browser.createObjectURL).not.toHaveBeenCalled();
  });

  it("removes the anchor and revokes immediately when handoff fails", async () => {
    const browser = installBrowserDownloadFixture({
      clickError: new Error("Browser download handoff failed."),
      removeError: new Error("Anchor cleanup failed."),
    });

    await expect(
      saveAttachmentResponse(
        responseWith(new Uint8Array([1, 2, 3]), "3"),
        "report.bin",
      ),
    ).rejects.toThrow("Browser download handoff failed");
    expect(browser.anchor.remove).toHaveBeenCalledOnce();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith(
      "blob:attachment-download",
    );
    expect(browser.setTimeout).not.toHaveBeenCalled();
  });

  it("revokes the object URL when DOM handoff setup fails", async () => {
    const browser = installBrowserDownloadFixture({
      createElementError: new Error("DOM setup failed."),
    });

    await expect(
      saveAttachmentResponse(
        responseWith(new Uint8Array([1, 2, 3]), "3"),
        "report.bin",
      ),
    ).rejects.toThrow("DOM setup failed");
    expect(browser.revokeObjectURL).toHaveBeenCalledWith(
      "blob:attachment-download",
    );
  });

  it("revokes immediately if delayed cleanup cannot be scheduled", async () => {
    const browser = installBrowserDownloadFixture({
      setTimeoutError: new Error("Timer unavailable."),
    });

    await expect(
      saveAttachmentResponse(
        responseWith(new Uint8Array([1, 2, 3]), "3"),
        "report.bin",
      ),
    ).resolves.toBeUndefined();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith(
      "blob:attachment-download",
    );
  });
});
