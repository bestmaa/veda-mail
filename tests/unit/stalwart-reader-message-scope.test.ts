import { describe, expect, it } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import {
  JMAP_MAIL,
  type JmapEmail,
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
  bodyValues: { text: { value: "Body" } },
  hasAttachment: false,
  id: "message",
  keywords: {},
  mailboxIds: { inbox: true },
  preview: "Body",
  receivedAt: "2026-07-23T10:00:00.000Z",
  size: 100,
  subject: "Scoped message",
  textBody: [{ partId: "text", type: "text/plain" }],
  threadId: "thread",
};

const readerFor = (
  result: Readonly<{
    accountId: string;
    list: readonly JmapEmail[];
    state: string;
  }>,
): StalwartMailReader => {
  const client = {
    getSession: async () => session,
    request: async () => ({ methodResponses: [], sessionState: "state" }),
    result: () => result,
  } as unknown as StalwartJmapClient;
  return new StalwartMailReader(client, {
    authType: "basic",
    baseUrl: "https://mail.example.com",
    secret: "secret",
    username: "test@example.com",
  });
};

describe("Stalwart message response scope", () => {
  it.each([
    [
      "account",
      { accountId: "other-account", list: [email], state: "state" },
    ],
    [
      "message",
      {
        accountId: "account",
        list: [{ ...email, id: "other-message" }],
        state: "state",
      },
    ],
  ])("rejects a mismatched %s response", async (_scope, result) => {
    await expect(
      readerFor(result).getMessage(id.message("message")),
    ).rejects.toThrow("Message not found.");
    await expect(
      readerFor(result).getReplyContext(id.message("message")),
    ).rejects.toThrow("message being replied to was not found");
  });
});
