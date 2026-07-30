import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { SendMessageInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { StalwartMailWriter } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.writer";
import type { JmapMethodCall } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const reader = {
  getAccount: async () => ({
    email: "sender@example.com",
    id: id.account("account"),
    name: "Sender",
    providerId: id.provider("stalwart-jmap"),
  }),
  getAccountId: async () => "account",
  listMailboxes: async () => [
    {
      color: "#000",
      id: id.mailbox("drafts"),
      name: "Drafts",
      role: "drafts",
      total: 0,
      unread: 0,
    },
    {
      color: "#000",
      id: id.mailbox("sent"),
      name: "Sent",
      role: "sent",
      total: 0,
      unread: 0,
    },
  ],
} as unknown as StalwartMailReader;

const input: SendMessageInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "Pre-submission boundary",
  to: [{ email: "recipient@example.com", name: null }],
};

const clientFailingAt = (
  stage: "identity" | "upload",
  failure: Error,
): {
  readonly client: StalwartJmapClient;
  readonly finalRequestCount: () => number;
} => {
  let finalRequests = 0;
  const client = {
    request: async (calls: readonly JmapMethodCall[]) => {
      if (calls[0]?.[0] === "Identity/get") {
        if (stage === "identity") throw failure;
        return { methodResponses: [], sessionState: "state" };
      }
      finalRequests += 1;
      return { methodResponses: [], sessionState: "state" };
    },
    result: (_response: unknown, callId: string) => {
      if (callId === "identities") {
        return {
          list: [
            { email: "sender@example.com", id: "identity", name: "Sender" },
          ],
        };
      }
      throw new Error("The final submission request was not expected.");
    },
    uploadAttachment: async () => {
      if (stage === "upload") throw failure;
      return {
        blobId: "provider-blob",
        size: 4,
        type: "application/octet-stream",
      };
    },
  } as unknown as StalwartJmapClient;
  return { client, finalRequestCount: () => finalRequests };
};

describe("Stalwart pre-submission failures", () => {
  it("keeps identity discovery failures retryable", async () => {
    const failure = new Error("Identity discovery failed.");
    const { client, finalRequestCount } = clientFailingAt("identity", failure);

    await expect(
      new StalwartMailWriter(client, reader).sendMessage(input),
    ).rejects.toBe(failure);
    expect(finalRequestCount()).toBe(0);
  });

  it("keeps attachment upload failures retryable", async () => {
    const failure = new Error("Attachment upload failed.");
    const { client, finalRequestCount } = clientFailingAt("upload", failure);
    const content = Buffer.from([0, 1, 2, 3]);

    await expect(
      new StalwartMailWriter(client, reader).sendMessage({
        ...input,
        attachments: [
          {
            content,
            id: id.attachmentUpload("upload-id"),
            mimeType: "application/octet-stream",
            name: "evidence.bin",
            sha256: createHash("sha256").update(content).digest("hex"),
            size: content.byteLength,
          },
        ],
      }),
    ).rejects.toBe(failure);
    expect(finalRequestCount()).toBe(0);
  });
});
