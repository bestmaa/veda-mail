import type { ImapFlow } from "imapflow";
import { describe, expect, it, vi } from "vitest";

import { searchImapDraftHeader } from
  "@/infrastructure/providers/imap-smtp/imap-draft-mailbox";

const header = "X-Veda-Compose-Id";
const value = "11111111-1111-4111-8111-111111111111";

describe("IMAP private draft header search", () => {
  it("uses the provider search result without fetching headers", async () => {
    const client = {
      fetchAll: vi.fn(),
      search: vi.fn().mockResolvedValue([7]),
    } as unknown as ImapFlow;

    await expect(searchImapDraftHeader(client, header, value))
      .resolves.toEqual([7]);
    expect(client.fetchAll).not.toHaveBeenCalled();
  });

  it("falls back to a bounded header-only fetch when SEARCH HEADER is empty", async () => {
    const uids = Array.from({ length: 261 }, (_, index) => index + 1);
    const client = {
      fetchAll: vi.fn().mockResolvedValue([
        { headers: Buffer.from(`${header}: other\r\n`), uid: 6 },
        { headers: Buffer.from(`${header}: ${value}\r\n`), uid: 261 },
      ]),
      search: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(uids),
    } as unknown as ImapFlow;

    await expect(searchImapDraftHeader(client, header, value))
      .resolves.toEqual([261]);
    expect(client.fetchAll).toHaveBeenCalledWith(
      uids.slice(-256),
      { headers: [header], uid: true },
      { uid: true },
    );
  });

  it("ignores an oversized provider header", async () => {
    const client = {
      fetchAll: vi.fn().mockResolvedValue([
        { headers: Buffer.alloc(8 * 1_024 + 1, 65), uid: 9 },
      ]),
      search: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce([9]),
    } as unknown as ImapFlow;

    await expect(searchImapDraftHeader(client, header, value))
      .resolves.toEqual([]);
  });

  it("unfolds a matching header value safely", async () => {
    const client = {
      fetchAll: vi.fn().mockResolvedValue([
        { headers: Buffer.from(`${header}:\r\n ${value}\r\n`), uid: 9 },
      ]),
      search: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce([9]),
    } as unknown as ImapFlow;

    await expect(searchImapDraftHeader(client, header, value))
      .resolves.toEqual([9]);
  });
});
