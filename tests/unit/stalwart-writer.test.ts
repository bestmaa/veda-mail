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
  const client = {
    request: async (nextCalls: readonly JmapMethodCall[]) => {
      calls = nextCalls;
      const create = nextCalls[0]?.[1]["create"] as
        | Readonly<Record<string, unknown>>
        | undefined;
      createKey = Object.keys(create ?? {})[0] ?? "";
      return { methodResponses: [], sessionState: "state" };
    },
    result: (_response: unknown, callId: string) => {
      if (callId === "identities") {
        return {
          list: [{ email: "sender@example.com", id: "identity", name: "Sender" }],
        };
      }
      if (callId === "create") {
        return { created: { [createKey]: { id: "email" } } };
      }
      return submissionFails
        ? { notCreated: { submit: { type: "forbiddenFrom" } } }
        : { created: { submit: { id: "submission" } } };
    },
  } as unknown as StalwartJmapClient;
  return { client, getCalls: () => calls };
};

describe("Stalwart writer", () => {
  it("updates the submitted email using the submission creation reference", async () => {
    const { client, getCalls } = createClient(false);
    await new StalwartMailWriter(client, reader).sendMessage(input);
    const submission = getCalls()[1]?.[1];

    expect(submission).toMatchObject({
      onSuccessUpdateEmail: {
        "#submit": {
          "keywords/$draft": null,
          "mailboxIds/drafts": null,
          "mailboxIds/sent": true,
        },
      },
    });
  });

  it("rejects a failed EmailSubmission creation", async () => {
    const { client } = createClient(true);
    await expect(
      new StalwartMailWriter(client, reader).sendMessage(input),
    ).rejects.toThrow("did not create");
  });
});
