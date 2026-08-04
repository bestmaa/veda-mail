import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentConnection: vi.fn(),
  getMailService: vi.fn(),
  inspect: vi.fn(),
  respond: vi.fn(),
}));

vi.mock("@/server/connections/connection-session", () => ({
  getCurrentConnection: mocks.getCurrentConnection,
}));
vi.mock("@/server/mail/mail-service", () => ({
  getMailService: mocks.getMailService,
}));
vi.mock("@/server/calendar/calendar-part-inspection", async () => {
  const actual = await vi.importActual<object>(
    "@/server/calendar/calendar-part-inspection",
  );
  return { ...actual, inspectCalendarPart: mocks.inspect };
});
vi.mock("@/server/calendar/calendar-response", () => ({
  respondToCalendarInvitation: mocks.respond,
}));

import { GET } from "@/app/api/v1/mail/messages/[messageId]/calendar/route";
import { POST } from "@/app/api/v1/mail/messages/[messageId]/calendar/respond/route";
import { asCalendarPartId } from "@/domain/mail/calendar";
import { id } from "@/domain/shared/brand";
import { mailSessionScope } from "@/server/connections/mail-session-scope";
import { parseCalendarInvitation } from "@/server/calendar/calendar-parser";

const origin = "https://mail.example.com";
const connection = {
  config: {}, createdAt: new Date(0).toISOString(), displayName: "Member",
  id: id.connection("calendar-route"), providerId: id.provider("mock"),
};
const part = {
  id: asCalendarPartId("calendar-part"), mimeType: "text/calendar" as const,
  name: "invite.ics", size: 300,
};
const invitation = parseCalendarInvitation([
  "BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT",
  "UID:meeting-1", "DTSTAMP:20260804T080000Z",
  "DTSTART:20260805T090000Z", "SEQUENCE:2", "SUMMARY:Planning",
  "ORGANIZER:mailto:host@example.com",
  "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:member@example.com",
  "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n"));
const service = {
  getAccount: vi.fn(async () => ({ email: "member@example.com" })),
  getMessage: vi.fn(async () => ({
    from: [{ email: "sender@example.com", name: null }],
  })),
  listCalendarParts: vi.fn(async () => [part]),
};
const context = { params: Promise.resolve({ messageId: "message-1" }) };

const request = (
  method: "GET" | "POST",
  body?: unknown,
  scope = mailSessionScope(connection),
  requestOrigin = origin,
) => new Request(`${origin}/api/v1/mail/messages/message-1/calendar`, {
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    host: "mail.example.com",
    origin: requestOrigin,
    "x-veda-mail-session-scope": scope,
  },
  method,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentConnection.mockResolvedValue(connection);
  mocks.getMailService.mockResolvedValue(service);
  mocks.inspect.mockResolvedValue({ invitation, part });
  mocks.respond.mockResolvedValue({
    partId: part.id,
    receipt: {
      deliveryStatus: "accepted", id: id.message("sent"),
      rejectedRecipients: [], submittedAt: new Date(0).toISOString(),
    },
    response: "ACCEPTED", sequence: 2, uid: "meeting-1",
  });
});

describe("calendar invitation routes", () => {
  it("returns scanned canonical invitation metadata and mismatch state", async () => {
    const response = await GET(request("GET"), context);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.invitations[0]).toMatchObject({
      canRespond: true,
      organizerMatchesSender: false,
      part: { id: "calendar-part" },
    });
    expect(payload.data.invitations[0].canonicalIcs).toContain("METHOD:REQUEST");
    expect(mocks.inspect).toHaveBeenCalledOnce();
  });

  it("returns an empty result without reading message content when no part exists", async () => {
    service.listCalendarParts.mockResolvedValueOnce([]);
    const response = await GET(request("GET"), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { invitations: [], invalidPartCount: 0 },
    });
    expect(service.getMessage).not.toHaveBeenCalled();
    expect(service.getAccount).not.toHaveBeenCalled();
  });

  it("rejects stale reads and unsafe response bodies", async () => {
    expect((await GET(request("GET", undefined, "stale"), context)).status)
      .toBe(409);
    expect((await POST(request("POST", {
      idempotencyKey: crypto.randomUUID(),
      ownerEmail: "victim@example.com",
      partId: part.id,
      response: "accepted",
    }), context)).status).toBe(400);
    expect((await POST(request("POST", {
      idempotencyKey: crypto.randomUUID(),
      partId: part.id,
      response: "accepted",
    }, mailSessionScope(connection), "https://attacker.example"), context)).status)
      .toBe(403);
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("passes only validated response fields to the idempotent responder", async () => {
    const key = crypto.randomUUID();
    const response = await POST(request("POST", {
      idempotencyKey: key, partId: part.id, response: "tentative",
    }), context);

    expect(response.status).toBe(201);
    expect(mocks.respond).toHaveBeenCalledWith(expect.objectContaining({
      connection,
      idempotencyKey: key,
      messageId: "message-1",
      partId: part.id,
      participationStatus: "TENTATIVE",
    }));
  });
});
