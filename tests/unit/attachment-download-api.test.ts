import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveAttachmentResponse: vi.fn(),
}));

vi.mock("@/transport/client/attachment-download-client", () => ({
  saveAttachmentResponse: mocks.saveAttachmentResponse,
}));

import { attachmentApi } from "@/transport/client/attachment-api";

const sessionScope = "attachment-download-session";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("attachment download API", () => {
  it("uses a scoped, non-cacheable same-origin request before browser handoff", async () => {
    const signal = new AbortController().signal;
    const response = new Response(new Uint8Array([1, 2, 3]));
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    await attachmentApi.downloadAttachment(
      "/api/v1/mail/messages/message/attachments/attachment",
      "report.pdf",
      sessionScope,
      signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mail/messages/message/attachments/attachment",
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-veda-mail-session-scope": sessionScope },
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal,
      },
    );
    expect(mocks.saveAttachmentResponse).toHaveBeenCalledWith(
      response,
      "report.pdf",
    );
  });

  it("surfaces a provider failure without attempting browser handoff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: "ATTACHMENT_PROVIDER_FAILED",
              message: "The attachment could not be retrieved.",
            },
          },
          { status: 502 },
        ),
      ),
    );

    await expect(
      attachmentApi.downloadAttachment(
        "/api/v1/mail/messages/message/attachments/attachment",
        "report.pdf",
        sessionScope,
      ),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_PROVIDER_FAILED",
      message: "The attachment could not be retrieved.",
      status: 502,
    });
    expect(mocks.saveAttachmentResponse).not.toHaveBeenCalled();
  });
});
