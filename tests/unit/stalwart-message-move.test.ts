import { describe, expect, it, vi } from "vitest";

import type { Mailbox } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";
import { mutateStalwartMessage } from "@/infrastructure/providers/stalwart-jmap/stalwart-message-mutation";

const mailbox = (
  mailboxId: string,
  rights: { readonly add: boolean; readonly remove: boolean },
): Mailbox => ({
  color: "#000", id: id.mailbox(mailboxId), name: mailboxId, parentId: null,
  rights: { mayAddItems: rights.add, mayCreateChild: true, mayDelete: false,
    mayRemoveItems: rights.remove, mayRename: false },
  role: "custom", sortOrder: 0, total: 0, unread: 0,
});

const fixture = (
  memberships: Record<string, boolean>,
  destinationAdd = true,
) => {
  const request = vi.fn().mockResolvedValue({ methodResponses: [] });
  const client = {
    request,
    result: vi.fn().mockImplementation((_response, callId) =>
      callId === "move-source"
        ? { accountId: "account-a", list: [{ id: "message-a", mailboxIds: memberships }],
            notFound: [], state: "email-state-a" }
        : { accountId: "account-a", updated: { "message-a": null } }),
  } as unknown as StalwartJmapClient;
  const reader = {
    getAccountId: vi.fn().mockResolvedValue("account-a"),
    getMailboxSnapshot: vi.fn().mockResolvedValue({
      accountId: "account-a",
      mailboxes: [
        mailbox("source/a", { add: true, remove: true }),
        mailbox("dest~b", { add: destinationAdd, remove: true }),
      ],
      state: "mailbox-state-a",
    }),
  } as unknown as StalwartMailReader;
  return { client, reader, request };
};

const mutation = {
  destinationMailboxId: id.mailbox("dest~b"),
  messageId: id.message("message-a"),
  sourceMailboxId: id.mailbox("source/a"),
  type: "move" as const,
};

describe("Stalwart JMAP message move", () => {
  it("patches only source and destination under the authoritative Email state", async () => {
    const setup = fixture({ "other": true, "source/a": true });

    await mutateStalwartMessage(setup.client, setup.reader, mutation);

    expect(setup.request).toHaveBeenNthCalledWith(2, [[
      "Email/set",
      {
        accountId: "account-a",
        ifInState: "email-state-a",
        update: { "message-a": {
          "mailboxIds/source~1a": null,
          "mailboxIds/dest~0b": true,
        } },
      },
      "mutation",
    ]], ["urn:ietf:params:jmap:mail"]);
  });

  it("fails before Email/set when destination insertion is denied", async () => {
    const setup = fixture({ "source/a": true }, false);

    await expect(mutateStalwartMessage(
      setup.client, setup.reader, mutation,
    )).rejects.toThrow("does not accept");
    expect(setup.request).toHaveBeenCalledOnce();
  });

  it("treats a retried already-applied move as achieved", async () => {
    const setup = fixture({ "dest~b": true });

    await mutateStalwartMessage(setup.client, setup.reader, mutation);

    expect(setup.request).toHaveBeenCalledOnce();
    expect(vi.mocked(setup.reader.getMailboxSnapshot)).not.toHaveBeenCalled();
  });
});
