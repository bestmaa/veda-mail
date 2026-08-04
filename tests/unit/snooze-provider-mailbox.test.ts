import { describe, expect, it, vi } from "vitest";

import {
  ensureImapSnoozedMailbox,
  findImapSnoozedMailbox,
} from "@/infrastructure/providers/imap-smtp/imap-snooze-mailbox";
import {
  ensureStalwartSnoozedMailbox,
  findStalwartSnoozedMailbox,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-snooze-mailbox";

const rights = { mayAddItems: true, mayRemoveItems: true };
const jmapMailbox = (id: string, name: string) => ({
  id, myRights: rights, name, parentId: null, role: null,
});
const imapMailbox = (path: string) => ({
  flags: new Set<string>(), listed: true, name: path, parentPath: "", path,
});

describe("owned snooze mailbox discovery", () => {
  it("does not adopt a foreign literal Snoozed mailbox", () => {
    const snapshot = { list: [jmapMailbox("foreign", "Snoozed")], state: "s1" };
    expect(findStalwartSnoozedMailbox(snapshot, null, "Snoozed · Veda Mail abc"))
      .toBeNull();
    expect(findImapSnoozedMailbox(
      [imapMailbox("Snoozed")] as never, "Snoozed · Veda Mail abc",
    )).toBeNull();
  });

  it("recovers the exact persisted JMAP name after a lost create response", async () => {
    const name = "Snoozed · Veda Mail abc";
    let reads = 0;
    const client = {
      request: vi.fn(async (calls: readonly [string, unknown, string][]) => {
        if (calls[0]?.[0] === "Mailbox/set") throw new Error("connection lost");
        reads += 1;
        return { methodResponses: [["Mailbox/get", {
          accountId: "a", list: reads === 1 ? [] : [jmapMailbox("owned", name)],
          notFound: [], state: `s${reads}`,
        }, "snooze-mailboxes"]] };
      }),
      result: (response: { methodResponses: readonly (readonly unknown[])[] }) =>
        response.methodResponses[0]?.[1],
    };
    await expect(ensureStalwartSnoozedMailbox(
      client as never, "a", null, name,
    )).resolves.toBe("owned");
  });

  it("recovers the exact persisted IMAP name after a lost create response", async () => {
    const name = "Snoozed · Veda Mail abc";
    let reads = 0;
    const client = {
      list: vi.fn(async () => {
        reads += 1;
        return reads === 1 ? [] : [imapMailbox(name)];
      }),
      mailboxCreate: vi.fn(async () => { throw new Error("connection lost"); }),
      mailboxSubscribe: vi.fn(async () => true),
    };
    await expect(ensureImapSnoozedMailbox(client as never, name)).resolves.toBe(name);
  });
});
