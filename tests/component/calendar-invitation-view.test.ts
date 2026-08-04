import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CalendarInvitationViewItem } from "@/presentation/features/mail-workspace/calendar-invitation.view-model";
import { CalendarInvitationView } from "@/presentation/features/mail-workspace/ui/calendar-invitation.view";
import { asCalendarPartId } from "@/domain/mail/calendar";

const item: CalendarInvitationViewItem = {
  canRespond: true,
  canonicalIcs: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  invitation: {
    event: {
      attendees: [{
        email: "member@example.com", name: "Member",
        participationStatus: "NEEDS-ACTION", rsvp: true,
      }],
      description: null,
      dtstamp: {
        kind: "date-time", value: "2026-08-04T08:00:00",
        zone: { kind: "utc" },
      },
      duration: null,
      endsAt: {
        kind: "date-time", value: "2026-08-05T10:00:00",
        zone: { kind: "utc" },
      },
      location: "Meeting room",
      organizer: { email: "host@example.com", name: "Host" },
      recurrenceId: null,
      recurrenceRule: null,
      sequence: 2,
      startsAt: {
        kind: "date-time", value: "2026-08-05T09:00:00",
        zone: { kind: "utc" },
      },
      summary: "Planning",
      uid: "meeting-1",
    },
    method: "REQUEST",
    productId: null,
  },
  organizerMatchesSender: false,
  part: {
    id: asCalendarPartId("calendar-part"), mimeType: "text/calendar",
    name: "invite.ics", size: 300,
  },
};

describe("calendar invitation view", () => {
  it("shows safe metadata, mismatch warning, and accessible actions", () => {
    const html = renderToStaticMarkup(createElement(CalendarInvitationView, {
      busyAction: null,
      error: null,
      isExporting: false,
      isLoading: false,
      onExport: vi.fn(),
      onImport: vi.fn(),
      onRespond: vi.fn(),
      snapshot: { invitations: [item], invalidPartCount: 1 },
      status: null,
    }));

    expect(html).toContain('aria-label="Calendar invitations"');
    expect(html).toContain("Planning");
    expect(html).toContain("Meeting room");
    expect(html).toContain("Sender and organizer addresses differ");
    expect(html).toContain("Accept");
    expect(html).toContain("Maybe");
    expect(html).toContain("Decline");
    expect(html).toContain("Add to calendar");
    expect(html).toContain("Export my calendar (.ics)");
    expect(html).toContain("malformed or unsupported calendar part");
  });

  it("does not offer RSVP controls for a cancellation", () => {
    const html = renderToStaticMarkup(createElement(CalendarInvitationView, {
      busyAction: null, error: null, isExporting: false, isLoading: false,
      onExport: vi.fn(), onImport: vi.fn(), onRespond: vi.fn(),
      snapshot: {
        invitations: [{
          ...item,
          canRespond: false,
          invitation: { ...item.invitation, method: "CANCEL" },
        }],
        invalidPartCount: 0,
      },
      status: null,
    }));

    expect(html).toContain("Cancellation");
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain(">Decline<");
  });
});
