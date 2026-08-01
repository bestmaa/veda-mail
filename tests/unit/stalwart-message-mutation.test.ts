import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { mutateStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-mutation";
import { ProviderMessageMutationRejectedError } from "@/infrastructure/providers/provider-message-mutation-error";

const reader = {
  getAccountId: vi.fn().mockResolvedValue("account-a"),
  listMailboxes: vi.fn().mockResolvedValue([
    {
      color: "#000",
      id: id.mailbox("archive-a"),
      name: "Archive",
      role: "archive",
      total: 0,
      unread: 0,
    },
  ]),
} as unknown as StalwartMailReader;

const client = (
  result: Record<string, unknown> = {},
  sourceMailboxIds: Record<string, boolean> = { "trash-a": true },
) => {
  const request = vi.fn().mockResolvedValue({ methodResponses: [] });
  const source = {
    accountId: "account-a",
    list: [{ id: "message-a", mailboxIds: sourceMailboxIds }],
    notFound: [],
    state: "state-a",
  };
  return {
    instance: {
      request,
      result: vi.fn().mockImplementation(
        (_response, callId) => callId === "destroy-source" ? source : result,
      ),
    } as unknown as StalwartJmapClient,
    request,
  };
};

describe("Stalwart message mutation", () => {
  it("uses JMAP destroy for permanent deletion", async () => {
    const jmap = client({ destroyed: ["message-a"] });

    await mutateStalwartMessage(jmap.instance, reader, {
      mailboxId: id.mailbox("trash-a"),
      messageId: id.message("message-a"),
      type: "destroy",
    });

    expect(jmap.request).toHaveBeenNthCalledWith(
      1,
      [[
        "Email/get",
        {
          accountId: "account-a",
          ids: ["message-a"],
          properties: ["id", "mailboxIds"],
        },
        "destroy-source",
      ]],
      ["urn:ietf:params:jmap:mail"],
    );
    expect(jmap.request).toHaveBeenNthCalledWith(
      2,
      [[
        "Email/set",
        {
          accountId: "account-a",
          destroy: ["message-a"],
          ifInState: "state-a",
        },
        "mutation",
      ]],
      ["urn:ietf:params:jmap:mail"],
    );
  });

  it("preserves keyword and target-mailbox mutations", async () => {
    const jmap = client({ updated: { "message-a": null } });
    await mutateStalwartMessage(jmap.instance, reader, {
      messageId: id.message("message-a"),
      type: "set-starred",
      value: true,
    });
    await mutateStalwartMessage(jmap.instance, reader, {
      messageId: id.message("message-a"),
      type: "archive",
    });

    expect(jmap.request).toHaveBeenNthCalledWith(
      1,
      [[
        "Email/set",
        {
          accountId: "account-a",
          update: { "message-a": { "keywords/$flagged": true } },
        },
        "mutation",
      ]],
      ["urn:ietf:params:jmap:mail"],
    );
    expect(jmap.request).toHaveBeenNthCalledWith(
      2,
      [[
        "Email/set",
        {
          accountId: "account-a",
          update: { "message-a": { mailboxIds: { "archive-a": true } } },
        },
        "mutation",
      ]],
      ["urn:ietf:params:jmap:mail"],
    );
  });

  it("rejects a provider permanent-delete failure", async () => {
    const jmap = client({ notDestroyed: { "message-a": { type: "forbidden" } } });

    await expect(mutateStalwartMessage(jmap.instance, reader, {
      mailboxId: id.mailbox("trash-a"),
      messageId: id.message("message-a"),
      type: "destroy",
    })).rejects.toBeInstanceOf(ProviderMessageMutationRejectedError);
  });

  it("does not report destroy success without the destroyed message id", async () => {
    const jmap = client({ destroyed: [] });

    const mutation = mutateStalwartMessage(jmap.instance, reader, {
      mailboxId: id.mailbox("trash-a"),
      messageId: id.message("message-a"),
      type: "destroy",
    });
    await expect(mutation).rejects.toThrow("did not confirm");
    await expect(mutation).rejects.not.toBeInstanceOf(
      ProviderMessageMutationRejectedError,
    );
  });

  it("rechecks source membership before issuing JMAP destroy", async () => {
    const jmap = client({}, { "inbox-a": true });

    await expect(mutateStalwartMessage(jmap.instance, reader, {
      mailboxId: id.mailbox("trash-a"),
      messageId: id.message("message-a"),
      type: "destroy",
    })).rejects.toThrow("outside the confirmed mailbox");
    expect(jmap.request).toHaveBeenCalledOnce();
  });
});
