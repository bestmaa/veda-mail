import { describe, expect, it } from "vitest";

import type { ComposeInput } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { StalwartMailWriter } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.writer";
import type { JmapMethodCall } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const input: ComposeInput = {
  bcc: [],
  body: "Hello",
  cc: [],
  subject: "Writer test",
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
  getReplyContext: async () => ({
    messageId: "source@example.com",
    references: ["parent@example.com"],
  }),
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

const createClient = (submissionFails: boolean) => {
  let calls: readonly JmapMethodCall[] = [];
  let createKey = "";
  const uploads: unknown[] = [];
  const client = {
    request: async (nextCalls: readonly JmapMethodCall[]) => {
      calls = nextCalls;
      const create = nextCalls[0]?.[1]["create"] as
        Readonly<Record<string, unknown>> | undefined;
      createKey = Object.keys(create ?? {})[0] ?? "";
      return {
        methodResponses: submissionFails
          ? []
          : [
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
      if (callId === "create") {
        return {
          accountId: "account",
          created: { [createKey]: { id: "email" } },
          newState: "email-state-2",
          oldState: "email-state-1",
        };
      }
      if (callId === "cleanup-rejected-submission") {
        return {
          accountId: "account",
          destroyed: ["email"],
          newState: "email-state-3",
          oldState: "email-state-2",
        };
      }
      return submissionFails
        ? { notCreated: { submit: { type: "forbiddenFrom" } } }
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

describe("Stalwart writer", () => {
  it("updates the submitted email using the submission creation reference", async () => {
    const { client, getCalls } = createClient(false);
    const receipt = await new StalwartMailWriter(client, reader).sendMessage(
      input,
    );
    const created = Object.values(
      (getCalls()[0]?.[1]["create"] as Readonly<Record<string, unknown>>) ?? {},
    )[0];
    const submission = getCalls()[1]?.[1];

    expect(created).toMatchObject({
      "header:Message-ID:asMessageIds": [
        expect.stringMatching(/^[0-9a-f-]{36}@example\.com$/),
      ],
    });
    expect(submission).toMatchObject({
      onSuccessUpdateEmail: {
        "#submit": {
          "keywords/$draft": null,
          "mailboxIds/drafts": null,
          "mailboxIds/sent": true,
        },
      },
    });
    expect(receipt.deliveryStatus).toBe("accepted");
    expect(receipt.rejectedRecipients).toEqual([]);
  });

  it("rejects a failed EmailSubmission creation", async () => {
    const { client } = createClient(true);
    await expect(
      new StalwartMailWriter(client, reader).sendMessage(input),
    ).rejects.toThrow("did not create");
  });

  it("keeps failures before the final submission request retryable", async () => {
    const setupFailure = new Error("Account setup unavailable.");
    const failingReader = {
      ...reader,
      getAccountId: async () => {
        throw setupFailure;
      },
    } as unknown as StalwartMailReader;
    const { client } = createClient(false);

    await expect(
      new StalwartMailWriter(client, failingReader).sendMessage(input),
    ).rejects.toBe(setupFailure);
  });

  it("derives reply headers from the provider-owned source message", async () => {
    const { client, getCalls } = createClient(false);
    await new StalwartMailWriter(client, reader).sendMessage({
      ...input,
      inReplyTo: id.message("source-email"),
    });
    const created = Object.values(
      (getCalls()[0]?.[1]["create"] as Readonly<Record<string, unknown>>) ?? {},
    )[0];

    expect(created).toMatchObject({
      "header:In-Reply-To:asMessageIds": ["source@example.com"],
      "header:References:asMessageIds": [
        "parent@example.com",
        "source@example.com",
      ],
    });
  });

  it("drops unsafe provider-owned reply identifiers", async () => {
    const unsafeReader = {
      ...reader,
      getReplyContext: async () => ({
        messageId: "source@example.com\r\nBcc: victim@example.com",
        references: ["parent@example.com"],
      }),
    } as unknown as StalwartMailReader;
    const { client, getCalls } = createClient(false);
    await new StalwartMailWriter(client, unsafeReader).sendMessage({
      ...input,
      inReplyTo: id.message("source-email"),
    });
    const created = Object.values(
      (getCalls()[0]?.[1]["create"] as Readonly<Record<string, unknown>>) ?? {},
    )[0];

    expect(created).not.toHaveProperty("header:In-Reply-To:asMessageIds");
    expect(created).not.toHaveProperty("header:References:asMessageIds");
  });

  it("creates structured CC and BCC recipients without To", async () => {
    const { client, getCalls } = createClient(false);
    await new StalwartMailWriter(client, reader).sendMessage({
      ...input,
      bcc: [{ email: "hidden@example.com", name: null }],
      cc: [{ email: "copy@example.com", name: "Copy" }],
      to: [],
    });
    const created = Object.values(
      (getCalls()[0]?.[1]["create"] as Readonly<Record<string, unknown>>) ?? {},
    )[0];

    expect(created).toMatchObject({
      bcc: [{ email: "hidden@example.com" }],
      cc: [{ email: "copy@example.com", name: "Copy" }],
      to: [],
    });
  });

});
