import { Readable } from "node:stream";

import type { ImapFlow, MessageStructureObject } from "imapflow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asCalendarPartId } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import {
  downloadImapCalendarPart,
  listImapCalendarParts,
} from "@/infrastructure/providers/imap-smtp/imap-calendar.reader";
import { encodeScopedImapMessageId } from "@/infrastructure/providers/imap-smtp/imap-codec";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const mocks = vi.hoisted(() => ({ close: vi.fn(), connect: vi.fn() }));
vi.mock("@/infrastructure/providers/imap-smtp/imap-client", () => ({
  closeImapClient: mocks.close,
  connectImapClient: mocks.connect,
}));

const config: ImapSmtpMemberConfig = {
  imapHost: "imap.example.com",
  imapPort: "993",
  imapSecurity: "tls",
  secret: "provider-secret",
  smtpHost: "smtp.example.com",
  smtpMaxMessageBytes: "26214400",
  smtpPort: "465",
  smtpSecurity: "tls",
  username: "member@example.com",
};
const messageId = id.message(encodeScopedImapMessageId(config, {
  mailbox: "INBOX",
  uid: 77,
  uidValidity: BigInt(9),
}));
const structure: MessageStructureObject = {
  childNodes: [
    { part: "1", type: "text/plain" },
    { encoding: "base64", part: "2", size: 999, type: "text/calendar" },
  ],
  type: "multipart/mixed",
};

const fakeClient = () => ({
  close: vi.fn(),
  download: vi.fn().mockResolvedValue({
    content: Readable.from([Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")]),
  }),
  fetchOne: vi.fn().mockResolvedValue({ bodyStructure: structure, uid: 77 }),
  mailboxOpen: vi.fn().mockResolvedValue({ uidValidity: BigInt(9) }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.close.mockResolvedValue(undefined);
});

describe("IMAP calendar provider reader", () => {
  it("discovers metadata without fetching message source or remote content", async () => {
    const client = fakeClient();
    mocks.connect.mockResolvedValue(client as unknown as ImapFlow);

    const parts = await listImapCalendarParts(config, { messageId });

    expect(client.mailboxOpen).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(client.fetchOne).toHaveBeenCalledWith(
      77,
      { bodyStructure: true, uid: true },
      { uid: true },
    );
    expect(parts).toMatchObject([
      { mimeType: "text/calendar", name: "invite.ics", size: null },
    ]);
    expect(client.download).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("revalidates UIDVALIDITY and exact section before streaming decoded bytes", async () => {
    const listingClient = fakeClient();
    mocks.connect.mockResolvedValueOnce(listingClient as unknown as ImapFlow);
    const [part] = await listImapCalendarParts(config, { messageId });
    if (!part) throw new Error("Missing calendar fixture.");
    const downloadClient = fakeClient();
    mocks.connect.mockResolvedValueOnce(downloadClient as unknown as ImapFlow);

    const download = await downloadImapCalendarPart(config, {
      calendarPartId: part.id,
      maxBytes: 1_024,
      messageId,
    });

    expect(downloadClient.download).toHaveBeenCalledWith(77, "2", {
      chunkSize: 64 * 1024,
      maxBytes: 1_025,
      uid: true,
    });
    expect(await new Response(download.body).text()).toContain("VCALENDAR");
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("rejects stale UIDVALIDITY and account-scoped message identifiers", async () => {
    const stale = fakeClient();
    stale.mailboxOpen.mockResolvedValue({ uidValidity: BigInt(10) });
    mocks.connect.mockResolvedValue(stale as unknown as ImapFlow);
    await expect(listImapCalendarParts(config, { messageId }))
      .rejects.toMatchObject({ code: "not_found" });
    expect(stale.fetchOne).not.toHaveBeenCalled();

    await expect(listImapCalendarParts({ ...config, username: "other@example.com" }, {
      messageId,
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects unknown part IDs and decoded bytes beyond the exact limit", async () => {
    const unknown = fakeClient();
    mocks.connect.mockResolvedValueOnce(unknown as unknown as ImapFlow);
    await expect(downloadImapCalendarPart(config, {
      calendarPartId: asCalendarPartId("unknown"),
      maxBytes: 1_024,
      messageId,
    })).rejects.toMatchObject({ code: "not_found" });
    expect(unknown.download).not.toHaveBeenCalled();

    const listing = fakeClient();
    mocks.connect.mockResolvedValueOnce(listing as unknown as ImapFlow);
    const [part] = await listImapCalendarParts(config, { messageId });
    if (!part) throw new Error("Missing calendar fixture.");
    const oversized = fakeClient();
    oversized.download.mockResolvedValue({ content: Readable.from([Buffer.alloc(5)]) });
    mocks.connect.mockResolvedValueOnce(oversized as unknown as ImapFlow);
    const download = await downloadImapCalendarPart(config, {
      calendarPartId: part.id,
      maxBytes: 4,
      messageId,
    });
    await expect(new Response(download.body).arrayBuffer())
      .rejects.toMatchObject({ code: "size_limit_exceeded" });
  });
});
