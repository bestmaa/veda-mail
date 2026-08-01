import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { mutateStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-mutation";

const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
const reader = (maySetKeywords = true) => ({
  getAccountId: vi.fn().mockResolvedValue("account-a"),
  getMailboxSnapshot: vi.fn().mockResolvedValue({
    accountId: "account-a",
    mailboxes: [{ id: id.mailbox("inbox-a"), rights: { maySetKeywords } }],
  }),
}) as unknown as StalwartMailReader;
const source = (keywords: Record<string, boolean> = {}) => ({
  accountId: "account-a",
  list: [{
    id: "message-a", keywords, mailboxIds: { "inbox-a": true },
  }],
  notFound: [], state: "email-state-a",
});
const session = (maxKeywordsPerEmail?: number) => ({
  capabilities: {
    "urn:ietf:params:jmap:mail": maxKeywordsPerEmail === undefined
      ? {} : { maxKeywordsPerEmail },
  },
});

describe("Stalwart portable label mutation", () => {
  it("conditions a label patch on authoritative state and mailbox rights", async () => {
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      getSession: vi.fn().mockResolvedValue(session(10)),
      request,
      result: vi.fn().mockImplementation((_response, callId) =>
        callId === "label-source"
          ? source({ "$seen": true })
          : { accountId: "account-a", updated: { "message-a": null } },
      ),
    } as unknown as StalwartJmapClient;

    await mutateStalwartMessage(client, reader(), {
      labelId, messageId: id.message("message-a"), type: "set-label", value: true,
    });

    expect(request).toHaveBeenNthCalledWith(2, [[
      "Email/set",
      {
        accountId: "account-a",
        ifInState: "email-state-a",
        update: { "message-a": { [`keywords/${labelId}`]: true } },
      },
      "mutation",
    ]], ["urn:ietf:params:jmap:mail"]);
  });

  it("rejects an addition before Email/set when keyword capacity is full", async () => {
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      getSession: vi.fn().mockResolvedValue(session(1)),
      request,
      result: vi.fn().mockReturnValue(source({ "$seen": true })),
    } as unknown as StalwartJmapClient;

    await expect(mutateStalwartMessage(client, reader(), {
      labelId, messageId: id.message("message-a"), type: "set-label", value: true,
    })).rejects.toThrow(/label limit/u);
    expect(request).toHaveBeenCalledOnce();
  });

  it("re-reads authoritative state once after a JMAP state mismatch", async () => {
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    let mutationResults = 0;
    const client = {
      getSession: vi.fn().mockResolvedValue(session()),
      request,
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "label-source") return source();
        if (mutationResults++ === 0) {
          throw new StalwartJmapMethodError({ type: "stateMismatch" });
        }
        return { accountId: "account-a", updated: { "message-a": null } };
      }),
    } as unknown as StalwartJmapClient;

    await mutateStalwartMessage(client, reader(), {
      labelId, messageId: id.message("message-a"), type: "set-label", value: true,
    });

    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects mutation when any containing mailbox lacks rights", async () => {
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      request,
      result: vi.fn().mockReturnValue(source()),
    } as unknown as StalwartJmapClient;

    await expect(mutateStalwartMessage(client, reader(false), {
      labelId, messageId: id.message("message-a"), type: "set-label", value: true,
    })).rejects.toThrow(/denied label changes/u);
    expect(request).toHaveBeenCalledOnce();
  });
});
