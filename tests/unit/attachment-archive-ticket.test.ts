import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTACHMENT_ARCHIVE_TICKET_TTL_MS,
  clearAttachmentArchiveTicketsForTests,
  consumeAttachmentArchiveTicket,
  issueAttachmentArchiveTicket,
  MAX_ATTACHMENT_ARCHIVE_TICKETS,
  MAX_ATTACHMENT_ARCHIVE_TICKETS_PER_CONNECTION,
} from "@/server/mail/attachment-archive-ticket";

const connectionId = "archive-ticket-connection";
const messageId = "archive-ticket-message";

const consume = (ticket: string, overrides: Record<string, string> = {}) =>
  consumeAttachmentArchiveTicket({
    connectionId,
    messageId,
    ticket,
    ...overrides,
  });

beforeEach(() => {
  clearAttachmentArchiveTicketsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-01T10:00:00.000Z"));
});

afterEach(() => {
  clearAttachmentArchiveTicketsForTests();
  vi.useRealTimers();
});

describe("attachment archive tickets", () => {
  it("issues a 256-bit opaque ticket with a thirty-second expiry", () => {
    const issued = issueAttachmentArchiveTicket({ connectionId, messageId });

    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(issued.ticket, "base64url")).toHaveLength(32);
    expect(issued.expiresAt).toBe("2026-08-01T10:00:30.000Z");
  });

  it("consumes a correctly bound ticket exactly once", () => {
    const { ticket } = issueAttachmentArchiveTicket({
      connectionId,
      messageId,
    });

    expect(() => consume(ticket)).not.toThrow();
    expect(() => consume(ticket)).toThrowError(
      expect.objectContaining({
        code: "ATTACHMENT_ARCHIVE_TICKET_INVALID",
        status: 403,
      }),
    );
  });

  it.each([
    ["connection", { connectionId: "other-connection" }],
    ["message", { messageId: "other-message" }],
  ])("burns a ticket presented with the wrong %s binding", (_label, overrides) => {
    const { ticket } = issueAttachmentArchiveTicket({
      connectionId,
      messageId,
    });

    expect(() => consume(ticket, overrides)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_ARCHIVE_TICKET_INVALID" }),
    );
    expect(() => consume(ticket)).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_ARCHIVE_TICKET_INVALID" }),
    );
  });

  it("uses the same non-leaking error for invalid, expired, and replayed tickets", () => {
    const malformed = "private-provider-token";
    let malformedError: unknown;
    try {
      consume(malformed);
    } catch (error) {
      malformedError = error;
    }

    const expired = issueAttachmentArchiveTicket({ connectionId, messageId });
    vi.advanceTimersByTime(ATTACHMENT_ARCHIVE_TICKET_TTL_MS);
    expect(() => consume(expired.ticket)).toThrowError(
      expect.objectContaining({
        code: "ATTACHMENT_ARCHIVE_TICKET_INVALID",
        message: "This attachment archive ticket is invalid or expired.",
      }),
    );
    expect(String(malformedError)).not.toContain(malformed);
  });

  it("enforces the per-connection outstanding cap", () => {
    for (
      let index = 0;
      index < MAX_ATTACHMENT_ARCHIVE_TICKETS_PER_CONNECTION;
      index += 1
    ) {
      issueAttachmentArchiveTicket({ connectionId, messageId: `${index}` });
    }

    expect(() =>
      issueAttachmentArchiveTicket({ connectionId, messageId }),
    ).toThrowError(
      expect.objectContaining({
        code: "ATTACHMENT_ARCHIVE_TICKET_BUSY",
        status: 429,
      }),
    );
    expect(() =>
      issueAttachmentArchiveTicket({
        connectionId: "other-connection",
        messageId,
      }),
    ).not.toThrow();
  });

  it("enforces the global outstanding cap and reclaims expired entries", () => {
    for (let index = 0; index < MAX_ATTACHMENT_ARCHIVE_TICKETS; index += 1) {
      issueAttachmentArchiveTicket({
        connectionId: `connection-${index}`,
        messageId,
      });
    }
    expect(() =>
      issueAttachmentArchiveTicket({ connectionId: "overflow", messageId }),
    ).toThrowError(
      expect.objectContaining({ code: "ATTACHMENT_ARCHIVE_TICKET_BUSY" }),
    );

    vi.advanceTimersByTime(ATTACHMENT_ARCHIVE_TICKET_TTL_MS);
    expect(() =>
      issueAttachmentArchiveTicket({ connectionId: "reclaimed", messageId }),
    ).not.toThrow();
  });
});
