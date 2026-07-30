import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  MAX_JMAP_BODY_VALUE_BYTES,
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

describe("Stalwart attachment metadata listing", () => {
  it("requests only presentation metadata and returns opaque file-card IDs", async () => {
    let calls: readonly JmapMethodCall[] = [];
    let requestSignal: AbortSignal | undefined;
    const controller = new AbortController();
    const client = {
      getSession: async () => session,
      request: async (
        nextCalls: readonly JmapMethodCall[],
        _using: readonly string[],
        signal?: AbortSignal,
      ) => {
        calls = nextCalls;
        requestSignal = signal;
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({
        accountId: "account",
        list: [
          {
            attachments: [
              {
                blobId: "private-provider-blob",
                cid: "<report@example.test>",
                disposition: "attachment",
                name: "../../report.pdf",
                partId: "report-part",
                size: 4,
                type: "application/pdf",
              },
              {
                blobId: "private-provider-blob-2",
                disposition: "inline",
                name: "notes.txt",
                size: 2,
                type: "text/plain",
              },
            ],
            id: "message",
          },
        ],
        state: "state",
      }),
    } as unknown as StalwartJmapClient;

    const result = await new StalwartMailReader(
      client,
      config,
    ).listMessageAttachments({
      messageId: id.message("message"),
      signal: controller.signal,
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
      fetchHTMLBodyValues: true,
      ids: ["message"],
      maxBodyValueBytes: MAX_JMAP_BODY_VALUE_BYTES,
      properties: ["id", "attachments", "htmlBody", "bodyValues"],
    });
    expect(requestSignal).toBe(controller.signal);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      disposition: "attachment",
      mimeType: "application/pdf",
      name: "_.._report.pdf",
      size: 4,
    });
    expect(result[1]).toMatchObject({ disposition: "attachment" });
    expect(JSON.stringify(result)).not.toContain("private-provider-blob");
    expect(JSON.stringify(result)).not.toContain("report-part");
    expect(JSON.stringify(result)).not.toContain("report@example.test");
  });

  it("rejects mismatched account and message responses", async () => {
    let result = {
      accountId: "other-account",
      list: [{ attachments: [], id: "message" }],
      state: "state",
    };
    const client = {
      getSession: async () => session,
      request: async () => ({ methodResponses: [], sessionState: "state" }),
      result: () => result,
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, config);

    await expect(
      reader.listMessageAttachments({ messageId: id.message("message") }),
    ).rejects.toMatchObject({ code: "not_found" });
    result = {
      accountId: "account",
      list: [{ attachments: [], id: "other-message" }],
      state: "state",
    };
    await expect(
      reader.listMessageAttachments({ messageId: id.message("message") }),
    ).rejects.toMatchObject({ code: "not_found" });
    result = {
      accountId: "account",
      list: [
        { attachments: [], id: "message" },
        { attachments: [], id: "unexpected-message" },
      ],
      state: "state",
    };
    await expect(
      reader.listMessageAttachments({ messageId: id.message("message") }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it.each([
    ["timeout", new DOMException("private timeout", "TimeoutError")],
    ["provider_failure", new Error("private JMAP method description")],
  ] as const)("normalizes %s metadata lookup failures", async (code, error) => {
    const client = {
      getSession: async () => session,
      request: async () => {
        throw error;
      },
    } as unknown as StalwartJmapClient;

    await expect(
      new StalwartMailReader(client, config).listMessageAttachments({
        messageId: id.message("message"),
      }),
    ).rejects.toMatchObject({ code });
  });

  it("maps caller cancellation during metadata lookup", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = {
      getSession: async () => session,
      request: async () => {
        throw new DOMException("private abort", "AbortError");
      },
    } as unknown as StalwartJmapClient;

    await expect(
      new StalwartMailReader(client, config).listMessageAttachments({
        messageId: id.message("message"),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("normalizes cold-session timeout before metadata lookup", async () => {
    const client = {
      getSession: async () => {
        throw new DOMException("private discovery URL", "TimeoutError");
      },
    } as unknown as StalwartJmapClient;

    await expect(
      new StalwartMailReader(client, config).listMessageAttachments({
        messageId: id.message("message"),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("normalizes cold-session abort before attachment download", async () => {
    const client = {
      getSession: async () => {
        throw new DOMException("private discovery URL", "AbortError");
      },
    } as unknown as StalwartJmapClient;

    await expect(
      new StalwartMailReader(client, config).downloadAttachment({
        attachmentId: id.attachment("attachment"),
        maxBytes: 1_024,
        messageId: id.message("message"),
      }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});
