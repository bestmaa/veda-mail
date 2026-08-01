import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeLabelCleanupCursor } from "@/infrastructure/providers/label-cleanup-cursor";
import { cleanupImapLabel } from "@/infrastructure/providers/imap-smtp/imap-label-cleanup";

const labelId = id.label("veda-label-aaaqeayeaudaocajbifqydiob4");
const input = { labelId, limit: 2 };
const cursorSecret = "imap-account-test-secret";
const listed = (path = "INBOX") => ({
  flags: new Set<string>(), listed: true, path,
});
const client = (overrides: Record<string, unknown> = {}) => ({
  fetchAll: vi.fn().mockResolvedValue([]),
  list: vi.fn().mockResolvedValue([listed()]),
  mailboxOpen: vi.fn().mockResolvedValue({ uidNext: 1, uidValidity: BigInt(1) }),
  messageFlagsRemove: vi.fn().mockResolvedValue(true),
  search: vi.fn().mockResolvedValue(false),
  ...overrides,
});

describe("IMAP bounded label cleanup", () => {
  it("bounds search to a fixed UID window and verifies every removed flag", async () => {
    const fixture = client({
      fetchAll: vi.fn().mockResolvedValue([
        { flags: new Set(["\\Seen"]), uid: 10 },
        { flags: new Set(), uid: 20 },
      ]),
      mailboxOpen: vi.fn().mockResolvedValue({ uidNext: 9_000, uidValidity: BigInt(9) }),
      search: vi.fn().mockResolvedValue([10, 20, 30]),
    });

    const result = await cleanupImapLabel(fixture as never, input, cursorSecret);

    expect(fixture.search).toHaveBeenCalledWith(
      { keyword: labelId, uid: "1:4096" }, { uid: true },
    );
    expect(fixture.messageFlagsRemove).toHaveBeenCalledWith(
      [10, 20], [labelId], { uid: true },
    );
    expect(result).toMatchObject({ complete: false, processed: 2, removed: 2 });
  });

  it("restarts a mailbox safely when UIDVALIDITY changes", async () => {
    const first = client({
      mailboxOpen: vi.fn().mockResolvedValue({ uidNext: 9_000, uidValidity: BigInt(1) }),
    });
    const firstResult = await cleanupImapLabel(first as never, input, cursorSecret);
    expect(firstResult.cursor).not.toBeNull();
    const second = client({
      mailboxOpen: vi.fn().mockResolvedValue({ uidNext: 100, uidValidity: BigInt(2) }),
    });

    await cleanupImapLabel(second as never, {
      ...input,
      cursor: firstResult.cursor!,
    }, cursorSecret);

    expect(second.search).toHaveBeenCalledWith(
      { keyword: labelId, uid: "1:99" }, { uid: true },
    );
  });

  it("requires a clean verification sweep before reporting completion", async () => {
    const first = await cleanupImapLabel(client() as never, input, cursorSecret);
    expect(first.complete).toBe(false);
    const second = await cleanupImapLabel(client() as never, {
      ...input,
      cursor: first.cursor!,
    }, cursorSecret);
    expect(second).toEqual({ complete: true, cursor: null, processed: 0, removed: 0 });
  });

  it("tolerates mailbox churn without opening a cursor-supplied path", async () => {
    const original = client({
      list: vi.fn().mockResolvedValue([listed("A"), listed("B")]),
    });
    const first = await cleanupImapLabel(original as never, input, cursorSecret);
    const churned = client({
      list: vi.fn().mockResolvedValue([listed("B")]),
    });

    await cleanupImapLabel(
      churned as never,
      { ...input, cursor: first.cursor! },
      cursorSecret,
    );

    expect(churned.mailboxOpen).toHaveBeenCalledWith("B");
  });

  it("rejects malformed cursors and unverified removals", async () => {
    await expect(cleanupImapLabel(client() as never, {
      ...input, cursor: "bm90LWpzb24",
    }, cursorSecret)).rejects.toThrow(/cursor is invalid/u);
    const forged = encodeLabelCleanupCursor({
      dirty: false,
      labelId,
      mailboxTag: null,
      nextUid: null,
      phase: "verify",
      provider: "imap",
      uidValidity: null,
      upperUid: null,
      version: 1,
    }, "wrong-secret");
    await expect(cleanupImapLabel(client() as never, {
      ...input, cursor: forged,
    }, cursorSecret)).rejects.toThrow(/cursor is invalid/u);
    const unverified = client({
      fetchAll: vi.fn().mockResolvedValue([{ flags: new Set([labelId]), uid: 7 }]),
      mailboxOpen: vi.fn().mockResolvedValue({ uidNext: 8, uidValidity: BigInt(1) }),
      search: vi.fn().mockResolvedValue([7]),
    });
    await expect(cleanupImapLabel(unverified as never, input, cursorSecret))
      .rejects.toThrow(/did not confirm/u);
  });
});
