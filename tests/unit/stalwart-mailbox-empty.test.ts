import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { emptyStalwartMailbox } from "@/infrastructure/providers/stalwart-jmap/stalwart-mailbox-empty";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";

const mailboxId = id.mailbox("trash-a");
const input = { mailboxId, limit: 2 };
const secret = "account-a-mailbox-empty-secret";
const confirmedAt = new Date("2026-08-01T10:00:00.000Z");
const reader = (accountId = "account-a") => ({
  getAccountId: vi.fn().mockResolvedValue(accountId),
}) as unknown as StalwartMailReader;
const rights = (mayRemoveItems = true) => ({
  accountId: "account-a",
  list: [{
    id: mailboxId,
    myRights: { mayReadItems: true, mayRemoveItems },
  }],
  state: "mailboxes-a",
});
const query = (ids: readonly string[], queryState = "query-a") => ({
  accountId: "account-a",
  ids,
  position: 0,
  queryState,
});
const changes = (
  oldQueryState = "query-a",
  added: readonly string[] = [],
) => ({
  accountId: "account-a",
  added: added.map((messageId, index) => ({ id: messageId, index })),
  hasMoreChanges: false,
  newQueryState: "query-b",
  oldQueryState,
  removed: [],
});
const source = (ids: readonly string[], state = "email-state-a") => ({
  accountId: "account-a",
  list: ids.map((messageId) => ({
    id: messageId,
    mailboxIds: { [mailboxId]: true },
  })),
  notFound: [],
  state,
});

const prepare = async (messageIds: readonly string[] = ["m1", "m2"]) => {
  const client = {
    request: vi.fn().mockResolvedValue({ methodResponses: [] }),
    result: vi.fn().mockImplementation((_response, callId) =>
      callId === "mailbox-empty-rights" ? rights() : query(messageIds),
    ),
  } as unknown as StalwartJmapClient;
  return {
    client,
    result: await emptyStalwartMailbox(client, reader(), input, secret, confirmedAt),
  };
};

describe("Stalwart bounded mailbox empty", () => {
  it("prepares and authenticates a cutoff before any destructive request", async () => {
    const prepared = await prepare();

    expect(prepared.result).toMatchObject({
      complete: false, processed: 0, removed: 0,
    });
    expect(prepared.result.cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(prepared.client.request).toHaveBeenCalledTimes(2);
    expect(prepared.client.request).toHaveBeenLastCalledWith([["Email/query", {
      accountId: "account-a",
      filter: { before: confirmedAt.toISOString(), inMailbox: mailboxId },
      limit: 2,
      position: 0,
    }, "mailbox-empty-query"]], ["urn:ietf:params:jmap:mail"]);
  });

  it("resumes the prepared snapshot with a bounded, state-guarded destroy", async () => {
    const prepared = await prepare();
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      request,
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "mailbox-empty-rights") return rights();
        if (callId === "mailbox-empty-query") return query(["m1", "m2"]);
        if (callId === "mailbox-empty-before") return changes();
        if (callId === "mailbox-empty-source") return source(["m1", "m2"]);
        if (callId === "mailbox-empty-set") {
          return { accountId: "account-a", destroyed: ["m1", "m2"] };
        }
        if (callId === "mailbox-empty-verify") return query(["m3"], "query-b");
        return changes();
      }),
    } as unknown as StalwartJmapClient;

    const result = await emptyStalwartMailbox(client, reader(), {
      ...input,
      cursor: prepared.result.cursor!,
    }, secret, new Date("2026-08-01T12:00:00.000Z"));

    expect(result).toMatchObject({
      complete: false,
      cursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/u),
      processed: 2,
      removed: 2,
    });
    expect(result.cursor).not.toBe(prepared.result.cursor);
    expect(request).toHaveBeenNthCalledWith(5, [["Email/set", {
      accountId: "account-a",
      destroy: ["m1", "m2"],
      ifInState: "email-state-a",
    }, "mailbox-empty-set"]], ["urn:ietf:params:jmap:mail"]);
    expect(request).toHaveBeenLastCalledWith([["Email/queryChanges", {
      accountId: "account-a",
      filter: { before: confirmedAt.toISOString(), inMailbox: mailboxId },
      maxChanges: 3,
      sinceQueryState: "query-a",
    }, "mailbox-empty-after"]], ["urn:ietf:params:jmap:mail"]);
  });

  it("restarts one authoritative batch after a state mismatch", async () => {
    const prepared = await prepare(["m1"]);
    let setResults = 0;
    const client = {
      request: vi.fn().mockResolvedValue({ methodResponses: [] }),
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "mailbox-empty-rights") return rights();
        if (callId === "mailbox-empty-query") return query(["m1"]);
        if (callId === "mailbox-empty-before") return changes();
        if (callId === "mailbox-empty-source") return source(["m1"]);
        if (callId === "mailbox-empty-set" && setResults++ === 0) {
          throw new StalwartJmapMethodError({ type: "stateMismatch" });
        }
        if (callId === "mailbox-empty-set") {
          return { accountId: "account-a", destroyed: ["m1"] };
        }
        if (callId === "mailbox-empty-verify") return query([], "query-b");
        return changes();
      }),
    } as unknown as StalwartJmapClient;

    await expect(emptyStalwartMailbox(client, reader(), {
      ...input, cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).resolves.toEqual({
      complete: true, cursor: null, processed: 1, removed: 1,
    });
    expect(client.request).toHaveBeenCalledTimes(12);
  });

  it("fails closed for denied rights or changed mailbox membership", async () => {
    const prepared = await prepare(["m1"]);
    const deniedClient = {
      request: vi.fn().mockResolvedValue({ methodResponses: [] }),
      result: vi.fn().mockReturnValue(rights(false)),
    } as unknown as StalwartJmapClient;
    await expect(emptyStalwartMailbox(deniedClient, reader(), {
      ...input, cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).rejects.toThrow(/denied emptying/u);

    const movedClient = {
      request: vi.fn().mockResolvedValue({ methodResponses: [] }),
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "mailbox-empty-rights") return rights();
        if (callId === "mailbox-empty-query") return query(["m1"]);
        if (callId === "mailbox-empty-before") return changes();
        return { ...source(["m1"]), list: [{ id: "m1", mailboxIds: { inbox: true } }] };
      }),
    } as unknown as StalwartJmapClient;
    await expect(emptyStalwartMailbox(movedClient, reader(), {
      ...input, cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).rejects.toThrow(/denied emptying/u);
  });

  it("abandons the snapshot when an older message is added after confirmation", async () => {
    const prepared = await prepare(["m1"]);
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      request,
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "mailbox-empty-rights") return rights();
        if (callId === "mailbox-empty-query") return query(["old-arrival"]);
        return changes("query-a", ["old-arrival"]);
      }),
    } as unknown as StalwartJmapClient;

    await expect(emptyStalwartMailbox(client, reader(), {
      ...input, cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).rejects.toThrow(/cursor is invalid/u);
    expect(request.mock.calls.some(([methods]) =>
      methods[0]?.[0] === "Email/set",
    )).toBe(false);
  });

  it("rejects forged, cross-mailbox, and cross-account cursors", async () => {
    const prepared = await prepare(["m1"]);
    const client = {} as StalwartJmapClient;
    await expect(emptyStalwartMailbox(client, reader(), {
      ...input,
      cursor: `${prepared.result.cursor!.slice(0, -1)}x`,
    }, secret, confirmedAt)).rejects.toThrow(/cursor is invalid/u);
    await expect(emptyStalwartMailbox(client, reader(), {
      ...input,
      mailboxId: id.mailbox("spam-a"),
      cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).rejects.toThrow(/cursor is invalid/u);
    await expect(emptyStalwartMailbox(client, reader("account-b"), {
      ...input,
      cursor: prepared.result.cursor!,
    }, secret, confirmedAt)).rejects.toThrow(/cursor is invalid/u);
  });

  it("completes preparation immediately when the snapshot is empty", async () => {
    await expect(prepare([])).resolves.toMatchObject({
      result: { complete: true, cursor: null, processed: 0, removed: 0 },
    });
  });
});
