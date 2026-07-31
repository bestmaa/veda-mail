import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { SendMessageInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { StalwartMailWriter } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.writer";
import type { JmapMethodCall } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const input: SendMessageInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "Writer attachment test",
  to: [{ email: "recipient@example.com", name: null }],
};

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

const captureClient = () => {
  let calls: readonly JmapMethodCall[] = [];
  let createKey = "";
  const uploads: unknown[] = [];
  const client = {
    request: async (nextCalls: readonly JmapMethodCall[]) => {
      calls = nextCalls;
      const create = nextCalls[0]?.[1]["create"] as
        | Readonly<Record<string, unknown>>
        | undefined;
      createKey = Object.keys(create ?? {})[0] ?? "";
      return {
        methodResponses: [
          [
            "Email/set",
            {
              accountId: "account",
              newState: "email-state-3",
              oldState: "email-state-2",
              updated: { email: null },
            },
            "submit",
          ],
        ],
        sessionState: "state",
      };
    },
    result: (_response: unknown, callId: string) => {
      if (callId === "identities") {
        return {
          list: [
            { email: "sender@example.com", id: "identity", name: "Sender" },
          ],
        };
      }
      return callId === "create"
        ? {
            accountId: "account",
            created: { [createKey]: { id: "email" } },
            newState: "email-state-2",
            oldState: "email-state-1",
          }
        : {
            accountId: "account",
            created: { submit: { id: "submission" } },
            newState: "submission-state-2",
            oldState: "submission-state-1",
          };
    },
    uploadAttachment: async (accountId: string, attachment: unknown) => {
      uploads.push({ accountId, attachment });
      return {
        blobId: "provider-blob",
        size: 4,
        type: "application/octet-stream",
      };
    },
  } as unknown as StalwartJmapClient;
  return { client, getCalls: () => calls, getUploads: () => uploads };
};

describe("Stalwart writer attachments", () => {
  it("uploads verified bytes and references the provider blob in MIME structure", async () => {
    const content = Buffer.from([0, 1, 2, 3]);
    const { client, getCalls, getUploads } = captureClient();
    await new StalwartMailWriter(client, reader).sendMessage({
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
    });
    const created = Object.values(
      (getCalls()[0]?.[1]["create"] as Readonly<Record<string, unknown>>) ?? {},
    )[0];

    expect(getUploads()).toHaveLength(1);
    expect(created).toMatchObject({
      bodyStructure: {
        subParts: [
          { partId: "body", type: "text/plain" },
          {
            blobId: "provider-blob",
            disposition: "attachment",
            name: "evidence.bin",
            type: "application/octet-stream",
          },
        ],
        type: "multipart/mixed",
      },
    });
    expect(created).not.toHaveProperty("textBody");
  });
});
