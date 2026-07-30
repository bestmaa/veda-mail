import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  MAX_JMAP_BODY_VALUE_BYTES,
  type JmapEmail,
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

const email: JmapEmail = {
  bodyValues: { text: { value: "Full body" } },
  from: [{ email: "sender@example.com" }],
  hasAttachment: false,
  id: "message",
  keywords: { $seen: true },
  mailboxIds: { inbox: true },
  preview: "Preview",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 100,
  subject: "Body flags",
  textBody: [{ partId: "text", type: "text/plain" }],
  threadId: "thread",
  to: [{ email: "test@example.com" }],
};

describe("Stalwart reader", () => {
  it("requests bounded text and HTML body values", async () => {
    let calls: readonly JmapMethodCall[] = [];
    const client = {
      getSession: async () => session,
      request: async (nextCalls: readonly JmapMethodCall[]) => {
        calls = nextCalls;
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({ accountId: "account", list: [email], state: "state" }),
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "test@example.com",
    });

    const result = await reader.getMessage(id.message("message"));
    const options = calls[0]?.[1];

    expect(result.textBody).toBe("Full body");
    expect(options).toMatchObject({
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
      fetchTextBodyValues: true,
      maxBodyValueBytes: MAX_JMAP_BODY_VALUE_BYTES,
    });
  });

  it("loads provider message identifiers for reply headers", async () => {
    let calls: readonly JmapMethodCall[] = [];
    let replyList = [
      {
        id: "message",
        messageId: ["source@example.com"],
        references: ["parent@example.com"],
      },
    ];
    const client = {
      getSession: async () => session,
      request: async (nextCalls: readonly JmapMethodCall[]) => {
        calls = nextCalls;
        return { methodResponses: [], sessionState: "state" };
      },
      result: () => ({
        accountId: "account",
        list: replyList,
        state: "state",
      }),
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "test@example.com",
    });

    await expect(reader.getReplyContext(id.message("message"))).resolves.toEqual(
      {
        messageId: "source@example.com",
        references: ["parent@example.com"],
      },
    );
    expect(calls[0]?.[1]).toMatchObject({
      ids: ["message"],
      properties: ["id", "messageId", "references"],
    });

    replyList = [];
    await expect(
      reader.getReplyContext(id.message("message")),
    ).rejects.toThrow("The message being replied to was not found.");
  });

  it("resolves an opaque attachment ID before provider byte access", async () => {
    const attachedEmail: JmapEmail = {
      ...email,
      attachments: [
        {
          blobId: "provider-secret-blob",
          disposition: "attachment",
          name: "report.pdf",
          partId: "provider-secret-part",
          size: 4,
          type: "application/pdf",
        },
      ],
      hasAttachment: true,
    };
    const downloadAttachment = vi.fn().mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1, 2, 3, 4));
          controller.close();
        },
      }),
      name: "report.pdf",
      size: 4,
    });
    let attachmentResult = {
      accountId: "account",
      list: [attachedEmail],
      state: "state",
    };
    const client = {
      downloadAttachment,
      getSession: async () => session,
      request: async () => ({ methodResponses: [], sessionState: "state" }),
      result: () => attachmentResult,
    } as unknown as StalwartJmapClient;
    const reader = new StalwartMailReader(client, {
      authType: "basic",
      baseUrl: "https://mail.example.com",
      secret: "secret",
      username: "test@example.com",
    });
    const detail = await reader.getMessage(id.message("message"));
    const attachment = detail.attachments[0];
    expect(attachment).toBeDefined();
    if (!attachment) return;

    const downloaded = await reader.downloadAttachment({
      attachmentId: attachment.id,
      maxBytes: 1_024,
      messageId: detail.id,
    });
    expect(
      Array.from(
        new Uint8Array(await new Response(downloaded.body).arrayBuffer()),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(downloadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "account",
        attachment: expect.objectContaining({
          contentId: null,
          metadata: expect.objectContaining({
            disposition: "attachment",
            id: attachment.id,
          }),
        }),
      }),
    );
    const boundAttachment = downloadAttachment.mock.calls[0]?.[0]?.attachment;
    expect(JSON.stringify(boundAttachment)).not.toContain(
      "provider-secret-blob",
    );
    expect(JSON.stringify(boundAttachment)).not.toContain(
      "provider-secret-part",
    );

    downloadAttachment.mockClear();
    await expect(
      reader.downloadAttachment({
        attachmentId: id.attachment("message-attachment-guessed"),
        maxBytes: 1_024,
        messageId: detail.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(downloadAttachment).not.toHaveBeenCalled();

    attachmentResult = {
      accountId: "other-account",
      list: [attachedEmail],
      state: "state",
    };
    await expect(
      reader.downloadAttachment({
        attachmentId: attachment.id,
        maxBytes: 1_024,
        messageId: detail.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(downloadAttachment).not.toHaveBeenCalled();

    attachmentResult = {
      accountId: "account",
      list: [{ ...attachedEmail, id: "other-message" }],
      state: "state",
    };
    await expect(
      reader.downloadAttachment({
        attachmentId: attachment.id,
        maxBytes: 1_024,
        messageId: detail.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(downloadAttachment).not.toHaveBeenCalled();
  });
});
