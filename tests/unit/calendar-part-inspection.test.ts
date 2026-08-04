import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispose: vi.fn(async () => undefined),
  open: vi.fn(),
  stage: vi.fn(),
}));

vi.mock("@/server/mail/received-attachment-scan-operation", () => ({
  stageReceivedAttachmentDownload: mocks.stage,
}));
vi.mock("@/server/mail/received-attachment-scan-service", () => ({
  receivedAttachmentScanSpool: async () => ({}),
}));

import type { MailGateway } from "@/application/ports/mail-provider.port";
import { asCalendarPartId } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import {
  inspectCalendarPart,
  MAX_CALENDAR_PART_BYTES,
} from "@/server/calendar/calendar-part-inspection";

const bytes = (value: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });

const calendar = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT",
  "UID:event-1", "DTSTAMP:20260804T080000Z",
  "DTSTART:20260805T090000Z", "SEQUENCE:0", "SUMMARY:Planning",
  "ORGANIZER:mailto:host@example.com",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:member@example.com",
  "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n");

const part = {
  id: asCalendarPartId("part-1"), mimeType: "text/calendar" as const,
  name: "invite.ics", size: 300,
};

const gateway = {
  downloadCalendarPart: vi.fn(async () => ({
    body: bytes(calendar), mimeType: "text/calendar" as const,
    name: "invite.ics", size: 300,
  })),
} as unknown as Pick<MailGateway, "downloadCalendarPart">;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.open.mockResolvedValue({
    body: bytes(calendar), mimeType: "application/octet-stream",
    name: "invite.ics", size: calendar.length,
  });
  mocks.stage.mockResolvedValue({
    dispose: mocks.dispose,
    mimeType: "text/calendar",
    name: "invite.ics",
    open: mocks.open,
    sha256: "digest",
    size: calendar.length,
  });
});

describe("calendar part inspection", () => {
  it("parses only the scanner-served exact part and disposes it", async () => {
    const result = await inspectCalendarPart(
      gateway,
      id.connection("connection-1"),
      id.message("message-1"),
      part,
    );

    expect(result.invitation.event.uid).toBe("event-1");
    expect(gateway.downloadCalendarPart).toHaveBeenCalledWith({
      calendarPartId: part.id,
      maxBytes: MAX_CALENDAR_PART_BYTES,
      messageId: "message-1",
    });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("rejects a scanner result whose media type is not calendar", async () => {
    mocks.stage.mockResolvedValue({
      dispose: mocks.dispose,
      mimeType: "text/plain",
      name: "invite.ics",
      open: mocks.open,
      sha256: "digest",
      size: calendar.length,
    });

    await expect(inspectCalendarPart(
      gateway,
      id.connection("connection-1"),
      id.message("message-1"),
      part,
    )).rejects.toMatchObject({ code: "CALENDAR_PART_TYPE_INVALID" });
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
