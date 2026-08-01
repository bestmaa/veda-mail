import { describe, expect, it, vi } from "vitest";

import type { Mailbox } from "@/domain/mail/mail";
import { id } from "@/domain/shared/brand";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { StalwartMailboxManager } from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox.manager";

const custom = (value: string): Mailbox => ({
  color: "#64748b",
  id: id.mailbox(value),
  name: value,
  parentId: null,
  rights: { mayCreateChild: true, mayDelete: true, mayRename: true },
  role: "custom",
  sortOrder: 0,
  total: 0,
  unread: 0,
});

const mocks = () => {
  const client = {
    request: vi.fn().mockResolvedValue({}),
    result: vi.fn(),
  };
  const reader = {
    getMailboxSnapshot: vi.fn(),
    listMailboxes: vi.fn(),
  };
  return { client, reader };
};

describe("Stalwart JMAP mailbox manager", () => {
  it("creates with an authoritative state precondition and returns the server id", async () => {
    const fixture = mocks();
    const created = custom("created-id");
    fixture.reader.getMailboxSnapshot.mockResolvedValue({
      accountId: "account-a", mailboxes: [], state: "state-a",
    });
    fixture.reader.listMailboxes.mockResolvedValue([created]);
    fixture.client.result.mockReturnValue({
      created: { mailbox: { id: created.id } },
    });
    const manager = new StalwartMailboxManager(
      fixture.client as never,
      fixture.reader as never,
    );

    const result = await manager.mutate({
      name: "Projects", parentId: null, type: "create",
    });

    expect(result.mailboxId).toBe(created.id);
    expect(fixture.client.request).toHaveBeenCalledWith(
      [["Mailbox/set", expect.objectContaining({
        accountId: "account-a",
        create: { mailbox: expect.objectContaining({
          name: "Projects", parentId: null, role: null,
        }) },
        ifInState: "state-a",
      }), "mailbox-mutation"]],
      ["urn:ietf:params:jmap:mail"],
    );
  });

  it("never opts into deleting messages with a mailbox", async () => {
    const fixture = mocks();
    const target = custom("target");
    fixture.reader.getMailboxSnapshot.mockResolvedValue({
      accountId: "account-a", mailboxes: [target], state: "state-a",
    });
    fixture.reader.listMailboxes.mockResolvedValue([]);
    fixture.client.result.mockReturnValue({ destroyed: [target.id] });
    const manager = new StalwartMailboxManager(
      fixture.client as never,
      fixture.reader as never,
    );

    await manager.mutate({ mailboxId: target.id, type: "delete" });

    expect(fixture.client.request).toHaveBeenCalledWith(
      [["Mailbox/set", expect.objectContaining({
        destroy: [target.id],
        ifInState: "state-a",
        onDestroyRemoveEmails: false,
      }), "mailbox-mutation"]],
      expect.any(Array),
    );
  });

  it("requires and returns a server-confirmed mailbox update", async () => {
    const fixture = mocks();
    const target = custom("target");
    fixture.reader.getMailboxSnapshot.mockResolvedValue({
      accountId: "account-a", mailboxes: [target], state: "state-a",
    });
    fixture.reader.listMailboxes.mockResolvedValue([
      { ...target, name: "Renamed" },
    ]);
    fixture.client.result.mockReturnValue({
      accountId: "account-a",
      updated: { [target.id]: null },
    });
    const manager = new StalwartMailboxManager(
      fixture.client as never,
      fixture.reader as never,
    );

    const result = await manager.mutate({
      mailboxId: target.id,
      name: "Renamed",
      type: "update",
    });

    expect(result.mailboxId).toBe(target.id);
    expect(result.mailboxes[0]?.name).toBe("Renamed");
    expect(fixture.client.request).toHaveBeenCalledWith(
      [["Mailbox/set", expect.objectContaining({
        accountId: "account-a",
        ifInState: "state-a",
        update: { [target.id]: { name: "Renamed" } },
      }), "mailbox-mutation"]],
      expect.any(Array),
    );
  });

  it("maps concurrent JMAP state changes to a retryable conflict", async () => {
    const fixture = mocks();
    fixture.reader.getMailboxSnapshot.mockResolvedValue({
      accountId: "account-a", mailboxes: [], state: "stale",
    });
    fixture.client.request.mockRejectedValue(
      new StalwartJmapMethodError({ type: "stateMismatch" }),
    );
    const manager = new StalwartMailboxManager(
      fixture.client as never,
      fixture.reader as never,
    );
    await expect(manager.mutate({
      name: "Projects", parentId: null, type: "create",
    })).rejects.toMatchObject({
      failure: "conflict",
    });
  });
});
