import { describe, expect, it, vi } from "vitest";

import { id } from "@/domain/shared/brand";
import { encodeMailboxId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import { emptyImapMailbox } from "@/infrastructure/providers/imap-smtp/imap-mailbox-empty";

const cursorSecret = "imap-mailbox-empty-test-secret";
const mailboxId = id.mailbox(encodeMailboxId("Junk"));
const input = { limit: 100, mailboxId };
const opened = (overrides: Record<string, unknown> = {}) => ({
  delimiter: "/",
  exists: 3,
  flags: new Set<string>(),
  listed: true,
  mailboxId: "object-junk",
  path: "Junk",
  readOnly: false,
  uidNext: 4,
  uidValidity: BigInt(7),
  ...overrides,
});
const client = (overrides: Record<string, unknown> = {}) => ({
  capabilities: new Map<string, boolean>([["UIDPLUS", true]]),
  mailboxOpen: vi.fn().mockResolvedValue(opened()),
  messageDelete: vi.fn().mockResolvedValue(true),
  search: vi.fn().mockResolvedValue(false),
  ...overrides,
});
const prepare = async (
  fixture: ReturnType<typeof client>,
  operation = input,
): Promise<string> => {
  const result = await emptyImapMailbox(
    fixture as never, operation, cursorSecret,
  );
  expect(result).toMatchObject({ complete: false, processed: 0, removed: 0 });
  expect(result.cursor).not.toBeNull();
  return result.cursor!;
};

describe("IMAP bounded mailbox emptying", () => {
  it("prepares and persists the snapshot before irreversible deletion", async () => {
    const fixture = client();

    const cursor = await prepare(fixture);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(fixture.mailboxOpen).toHaveBeenCalledWith("Junk");
    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });

  it("uses bounded UID windows and exact UIDPLUS deletion batches", async () => {
    const fixture = client({
      mailboxOpen: vi.fn().mockResolvedValue(opened({
        exists: 8_999, uidNext: 9_000,
      })),
      search: vi.fn()
        .mockResolvedValueOnce([10, 20, 30])
        .mockResolvedValueOnce(false),
    });
    const cursor = await prepare(fixture);

    const result = await emptyImapMailbox(fixture as never, {
      ...input, cursor, limit: 2,
    }, cursorSecret);

    expect(fixture.search).toHaveBeenNthCalledWith(
      1, { uid: "1:4096" }, { uid: true },
    );
    expect(fixture.messageDelete).toHaveBeenCalledWith(
      [10, 20], { uid: true },
    );
    expect(fixture.search).toHaveBeenNthCalledWith(
      2, { uid: "10,20" }, { uid: true },
    );
    expect(result).toMatchObject({ complete: false, processed: 20, removed: 2 });
  });

  it("preserves messages arriving after the prepared upper UID", async () => {
    const fixture = client({
      mailboxOpen: vi.fn()
        .mockResolvedValueOnce(opened())
        .mockResolvedValueOnce(opened({ exists: 5, uidNext: 6 })),
      search: vi.fn()
        .mockResolvedValueOnce([1, 2, 3])
        .mockResolvedValueOnce(false),
    });
    const cursor = await prepare(fixture);

    const result = await emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    );

    expect(fixture.search).toHaveBeenNthCalledWith(
      1, { uid: "1:3" }, { uid: true },
    );
    expect(fixture.messageDelete).toHaveBeenCalledWith(
      [1, 2, 3], { uid: true },
    );
    expect(result).toEqual({
      complete: true, cursor: null, processed: 3, removed: 3,
    });
  });

  it("expires the snapshot when OBJECTID identifies a new mailbox", async () => {
    const fixture = client({
      mailboxOpen: vi.fn()
        .mockResolvedValueOnce(opened())
        .mockResolvedValueOnce(opened({
          mailboxId: "object-recreated",
        })),
    });
    const cursor = await prepare(fixture);

    await expect(emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    )).rejects.toThrow("Mailbox empty cursor is invalid");
    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });

  it("expires the snapshot when UIDVALIDITY changes", async () => {
    const fixture = client({
      mailboxOpen: vi.fn()
        .mockResolvedValueOnce(opened({ mailboxId: undefined }))
        .mockResolvedValueOnce(opened({
          mailboxId: undefined, uidValidity: BigInt(8),
        })),
    });
    const cursor = await prepare(fixture);

    await expect(emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    )).rejects.toThrow("Mailbox empty cursor is invalid");
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });

  it("binds authenticated cursors to the exact mailbox", async () => {
    const original = client();
    const cursor = await prepare(original);
    const other = client({
      mailboxOpen: vi.fn().mockResolvedValue(opened({ path: "Trash" })),
    });

    await expect(emptyImapMailbox(other as never, {
      cursor,
      limit: 100,
      mailboxId: id.mailbox(encodeMailboxId("Trash")),
    }, cursorSecret)).rejects.toThrow(/cursor is invalid/u);
    expect(other.mailboxOpen).not.toHaveBeenCalled();
  });

  it("fails closed when exact UID expunge is unavailable", async () => {
    const fixture = client({
      capabilities: new Map<string, boolean>(),
      search: vi.fn().mockResolvedValue([1]),
    });
    const cursor = await prepare(fixture);

    await expect(emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    )).rejects.toThrow(/requires UIDPLUS/u);
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });

  it("reports monotonic progress across sparse empty UID windows", async () => {
    const fixture = client({
      mailboxOpen: vi.fn().mockResolvedValue(opened({
        exists: 1, uidNext: 9_001,
      })),
      search: vi.fn().mockResolvedValue(false),
    });
    const cursor = await prepare(fixture);

    const first = await emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    );
    const second = await emptyImapMailbox(
      fixture as never, { ...input, cursor: first.cursor! }, cursorSecret,
    );

    expect(first).toMatchObject({ complete: false, processed: 4_096, removed: 0 });
    expect(second).toMatchObject({ complete: false, processed: 4_096, removed: 0 });
  });

  it("rejects a read-only mailbox before searching or deleting", async () => {
    const fixture = client({
      mailboxOpen: vi.fn().mockResolvedValue(opened({ readOnly: true })),
    });

    await expect(emptyImapMailbox(
      fixture as never, input, cursorSecret,
    )).rejects.toThrow(/did not open the expected mailbox/u);
    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });

  it("rejects deletion the server does not confirm", async () => {
    const fixture = client({
      search: vi.fn()
        .mockResolvedValueOnce([1])
        .mockResolvedValueOnce([1]),
    });
    const cursor = await prepare(fixture);

    await expect(emptyImapMailbox(
      fixture as never, { ...input, cursor }, cursorSecret,
    )).rejects.toThrow(/did not confirm/u);
  });

  it("completes an initially empty mailbox without a cursor", async () => {
    const fixture = client({
      mailboxOpen: vi.fn().mockResolvedValue(opened({ exists: 0, uidNext: 51 })),
    });

    await expect(emptyImapMailbox(
      fixture as never, input, cursorSecret,
    )).resolves.toEqual({
      complete: true, cursor: null, processed: 0, removed: 0,
    });
    expect(fixture.search).not.toHaveBeenCalled();
    expect(fixture.messageDelete).not.toHaveBeenCalled();
  });
});
