import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn((_connection, _owner, receipt) => receipt),
  fail: vi.fn(),
  inspect: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("@/server/calendar/calendar-part-inspection", () => ({
  findCalendarPart: (parts: readonly { id: string }[], partId: string) =>
    parts.find(({ id }) => id === partId),
  inspectCalendarPart: mocks.inspect,
  MAX_CALENDAR_PARTS_PER_MESSAGE: 8,
}));

vi.mock("@/server/mail/send-idempotency", () => ({
  completeIdempotentSend: mocks.complete,
  failIdempotentSend: mocks.fail,
  prepareIdempotentSend: mocks.prepare,
}));

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { asCalendarPartId } from "@/domain/mail/calendar";
import type { ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";
import { respondToCalendarInvitation } from "@/server/calendar/calendar-response";

const invitation = parseCalendarInvitation([
  "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST",
  "BEGIN:VEVENT", "UID:meeting-1", "DTSTAMP:20260804T080000Z",
  "DTSTART:20260805T090000Z", "SEQUENCE:2", "SUMMARY:Planning",
  "ORGANIZER;CN=Host:mailto:host@example.com",
  "ATTENDEE;CN=Member;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:member@example.com",
  "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n"));

const part = {
  id: asCalendarPartId("calendar-part"),
  mimeType: "text/calendar" as const,
  name: "invite.ics",
  size: 400,
};

const connection: ProviderConnection = {
  config: {}, createdAt: new Date(0).toISOString(), displayName: "Member",
  id: id.connection("connection-1"), providerId: id.provider("mock"),
};

const service = (sendMessage = vi.fn(async () => ({
  deliveryStatus: "accepted" as const,
  id: id.message("sent-1"), rejectedRecipients: [],
  submittedAt: new Date(0).toISOString(),
}))) => ({
  getAccount: vi.fn(async () => ({
    email: "member@example.com", id: id.account("account-1"),
    name: "Member", providerId: id.provider("mock"),
  })),
  listCalendarParts: vi.fn(async () => [part]),
  sendMessage,
}) as unknown as MailApplicationService;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue({ invitation, part });
  mocks.prepare.mockResolvedValue({
    kind: "owner",
    owner: { draftId: id.draft("calendar-draft"), token: "token" },
  });
});

describe("calendar invitation response", () => {
  it("sends a canonical attendee-only METHOD=REPLY", async () => {
    const gateway = service();
    const result = await respondToCalendarInvitation({
      connection, gateway, idempotencyKey: crypto.randomUUID(),
      messageId: id.message("message-1"), partId: part.id,
      participationStatus: "ACCEPTED",
    });
    const send = vi.mocked(gateway.sendMessage);
    const outgoing = send.mock.calls[0]?.[0];

    expect(outgoing?.to).toEqual([{ email: "host@example.com", name: "Host" }]);
    expect(outgoing?.attachments?.[0]).toMatchObject({
      calendarMethod: "REPLY", mimeType: "text/calendar", name: "reply.ics",
    });
    expect(Buffer.from(outgoing?.attachments?.[0]?.content ?? [])
      .toString("utf8")).toContain("PARTSTAT=ACCEPTED");
    expect(result).toMatchObject({ response: "ACCEPTED", sequence: 2, uid: "meeting-1" });
    expect(mocks.complete).toHaveBeenCalledOnce();
  });

  it("replays a completed attempt without sending again", async () => {
    const gateway = service();
    mocks.prepare.mockResolvedValue({
      kind: "replay",
      receipt: {
        deliveryStatus: "accepted", id: id.message("existing"),
        rejectedRecipients: [], submittedAt: new Date(0).toISOString(),
      },
    });

    const result = await respondToCalendarInvitation({
      connection, gateway, idempotencyKey: crypto.randomUUID(),
      messageId: id.message("message-1"), partId: part.id,
      participationStatus: "DECLINED",
    });

    expect(gateway.sendMessage).not.toHaveBeenCalled();
    expect(result.receipt.id).toBe("existing");
  });
});
