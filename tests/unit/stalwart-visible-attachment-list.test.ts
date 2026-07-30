import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { mapVisibleMessageAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  type JmapBodyPart,
  type JmapMethodCall,
  type JmapSession,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const session: JmapSession = {
  accounts: { account: { isReadOnly: false, name: "Test" } },
  apiUrl: "https://mail.example.com/jmap",
  capabilities: {},
  downloadUrl: "https://mail.example.com/download",
  primaryAccounts: { [JMAP_MAIL]: "account" },
  uploadUrl: "https://mail.example.com/upload",
  username: "test@example.com",
};

const config = {
  authType: "basic",
  baseUrl: "https://mail.example.com",
  secret: "secret",
  username: "test@example.com",
} as const;

const imagePart = (index: number): JmapBodyPart => ({
  blobId: `private-image-${index}`,
  cid: `image-${index}@example.test`,
  disposition: "inline",
  name: `image-${index}.png`,
  partId: `image-part-${index}`,
  size: index,
  type: "image/png",
});

const readerForEmail = (
  email: Readonly<Record<string, unknown>>,
): StalwartMailReader => {
  const client = {
    getSession: async () => session,
    request: async () => ({ methodResponses: [], sessionState: "state" }),
    result: () => ({
      accountId: "account",
      list: [email],
      state: "state",
    }),
  } as unknown as StalwartJmapClient;
  return new StalwartMailReader(client, config);
};

describe("Stalwart visible attachment listing", () => {
  it("excludes rendered inline images and includes unreferenced fallbacks", async () => {
    const rendered = imagePart(1);
    const unreferenced = imagePart(2);
    const listed = await readerForEmail({
      attachments: [
        rendered,
        unreferenced,
        {
          blobId: "private-report",
          disposition: "attachment",
          name: "report.pdf",
          partId: "report",
          size: 20,
          type: "application/pdf",
        },
      ],
      bodyValues: {
        html: {
          value: '<p>Body</p><img src="cid:image-1@example.test">',
        },
      },
      htmlBody: [{ partId: "html", type: "text/html" }],
      id: "message",
    }).listMessageAttachments({ messageId: id.message("message") });

    expect(listed.map(({ name }) => name)).toEqual([
      "image-2.png",
      "report.pdf",
    ]);
    expect(listed.every(({ disposition }) => disposition === "attachment"))
      .toBe(true);
    expect(JSON.stringify(listed)).not.toContain("private-");
  });

  it("includes the ninth referenced image after the global render cap", async () => {
    const images = Array.from({ length: 9 }, (_, index) =>
      imagePart(index + 1),
    );
    const html = images
      .map(
        (_, index) =>
          `<img src="cid:image-${index + 1}@example.test">`,
      )
      .join("");
    const listed = await readerForEmail({
      attachments: images,
      bodyValues: { html: { value: html } },
      htmlBody: [{ partId: "html", type: "text/html" }],
      id: "message",
    }).listMessageAttachments({ messageId: id.message("message") });

    expect(listed).toMatchObject([
      { disposition: "attachment", name: "image-9.png" },
    ]);
  });

  it("propagates a caller abort through session and Email/get", async () => {
    const controller = new AbortController();
    const getSession = vi.fn(async (signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return session;
    });
    const request = vi.fn(
      async (
        _calls: readonly JmapMethodCall[],
        _using: readonly string[],
        signal?: AbortSignal,
      ) =>
        new Promise<never>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("private", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = {
      getSession,
      request,
    } as unknown as StalwartJmapClient;
    const pending = new StalwartMailReader(
      client,
      config,
    ).listMessageAttachments({
      messageId: id.message("message"),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(getSession).toHaveBeenCalledWith(controller.signal);
    expect(request.mock.calls[0]?.[2]).toBe(controller.signal);
  });

  it("keeps body-value fetches out of attachment download lookups", async () => {
    const email = {
      attachments: [
        {
          blobId: "private-report",
          disposition: "attachment",
          name: "report.pdf",
          partId: "report",
          size: 4,
          type: "application/pdf",
        },
      ],
      htmlBody: [],
      id: "message",
    };
    const calls: JmapMethodCall[] = [];
    const client = {
      downloadAttachment: vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>(),
        mimeType: "application/pdf",
        name: "report.pdf",
        size: 4,
      })),
      getSession: async () => session,
      request: async (nextCalls: readonly JmapMethodCall[]) => {
        calls.push(...nextCalls);
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({
        accountId: "account",
        list: [email],
        state: "state",
      }),
    } as unknown as StalwartJmapClient;
    const attachment = mapVisibleMessageAttachments(email, "account")[0];
    expect(attachment).toBeDefined();
    if (!attachment) return;

    await new StalwartMailReader(client, config).downloadAttachment({
      attachmentId: attachment.id,
      maxBytes: 1_024,
      messageId: id.message("message"),
    });

    expect(calls[0]?.[1]).toEqual({
      accountId: "account",
      bodyProperties: [
        "partId",
        "blobId",
        "size",
        "name",
        "type",
        "disposition",
        "cid",
      ],
      ids: ["message"],
      properties: ["id", "attachments", "htmlBody"],
    });
  });
});
