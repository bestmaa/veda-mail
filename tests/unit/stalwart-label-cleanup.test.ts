import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeLabelCleanupCursor } from "@/infrastructure/providers/label-cleanup-cursor";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { StalwartJmapMethodError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { cleanupStalwartLabel } from "@/infrastructure/providers/stalwart-jmap/stalwart-label-cleanup";
import type { StalwartMailReader } from "@/infrastructure/providers/stalwart-jmap/stalwart-mail.reader";

const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
const input = { labelId, limit: 2 };
const cursorSecret = "account-a-test-secret";
const reader = (maySetKeywords = true) => ({
  getAccountId: vi.fn().mockResolvedValue("account-a"),
  getMailboxSnapshot: vi.fn().mockResolvedValue({
    accountId: "account-a",
    mailboxes: [{ id: id.mailbox("inbox-a"), rights: { maySetKeywords } }],
  }),
}) as unknown as StalwartMailReader;
const source = (messageIds: readonly string[], state = "state-a") => ({
  accountId: "account-a",
  list: messageIds.map((messageId) => ({
    id: messageId,
    keywords: { [labelId]: true },
    mailboxIds: { "inbox-a": true },
  })),
  notFound: [],
  state,
});

describe("Stalwart bounded label cleanup", () => {
  it("removes one bounded batch and verifies whether work remains", async () => {
    const request = vi.fn().mockResolvedValue({ methodResponses: [] });
    const client = {
      request,
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "label-cleanup-query") {
          return { accountId: "account-a", ids: ["m1", "m2"], position: 0, queryState: "q1" };
        }
        if (callId === "label-cleanup-source") return source(["m1", "m2"]);
        if (callId === "label-cleanup-set") {
          return { accountId: "account-a", updated: { m1: null, m2: null } };
        }
        return { accountId: "account-a", ids: ["m3"], position: 0, queryState: "q2" };
      }),
    } as unknown as StalwartJmapClient;

    const result = await cleanupStalwartLabel(
      client, reader(), input, cursorSecret,
    );

    expect(result).toMatchObject({ complete: false, processed: 2, removed: 2 });
    expect(result.cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(request).toHaveBeenNthCalledWith(3, [["Email/set", {
      accountId: "account-a",
      ifInState: "state-a",
      update: {
        m1: { [`keywords/${labelId}`]: null },
        m2: { [`keywords/${labelId}`]: null },
      },
    }, "label-cleanup-set"]], ["urn:ietf:params:jmap:mail"]);
  });

  it("restarts the authoritative batch once after a state race", async () => {
    let setResults = 0;
    const client = {
      request: vi.fn().mockResolvedValue({ methodResponses: [] }),
      result: vi.fn().mockImplementation((_response, callId) => {
        if (callId === "label-cleanup-query") {
          return { accountId: "account-a", ids: ["m1"], position: 0, queryState: "q" };
        }
        if (callId === "label-cleanup-source") return source(["m1"]);
        if (callId === "label-cleanup-set" && setResults++ === 0) {
          throw new StalwartJmapMethodError({ type: "stateMismatch" });
        }
        if (callId === "label-cleanup-set") {
          return { accountId: "account-a", updated: { m1: null } };
        }
        return { accountId: "account-a", ids: [], position: 0, queryState: "done" };
      }),
    } as unknown as StalwartJmapClient;

    await expect(cleanupStalwartLabel(
      client, reader(), input, cursorSecret,
    )).resolves.toEqual({
      complete: true, cursor: null, processed: 1, removed: 1,
    });
    expect(client.request).toHaveBeenCalledTimes(7);
  });

  it("fails closed when any containing mailbox denies keyword writes", async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ methodResponses: [] }),
      result: vi.fn().mockImplementation((_response, callId) =>
        callId === "label-cleanup-query"
          ? { accountId: "account-a", ids: ["m1"], position: 0, queryState: "q" }
          : source(["m1"]),
      ),
    } as unknown as StalwartJmapClient;

    await expect(cleanupStalwartLabel(
      client, reader(false), input, cursorSecret,
    ))
      .rejects.toThrow(/denied label cleanup/u);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed or cross-label continuation cursor", async () => {
    const client = {} as StalwartJmapClient;
    await expect(cleanupStalwartLabel(client, reader(), {
      ...input,
      cursor: Buffer.from('{"version":1}', "utf8").toString("base64url"),
    }, cursorSecret)).rejects.toThrow(/cursor is invalid/u);
    const forged = encodeLabelCleanupCursor({
      labelId, provider: "jmap", version: 1,
    }, "wrong-secret");
    await expect(cleanupStalwartLabel(client, reader(), {
      ...input, cursor: forged,
    }, cursorSecret)).rejects.toThrow(/cursor is invalid/u);
    await expect(cleanupStalwartLabel(client, reader(), {
      ...input,
      limit: 101,
    }, cursorSecret)).rejects.toThrow(/batch size is invalid/u);
  });
});
