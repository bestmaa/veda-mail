import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { ApiError } from "@/transport/http/api-error";

export const ATTACHMENT_ARCHIVE_TICKET_TTL_MS = 30_000;
export const MAX_ATTACHMENT_ARCHIVE_TICKETS = 512;
export const MAX_ATTACHMENT_ARCHIVE_TICKETS_PER_CONNECTION = 8;

const ATTACHMENT_ARCHIVE_TICKET_BYTES = 32;
const ATTACHMENT_ARCHIVE_TICKET_PURPOSE = "attachment-archive-download";
const MAX_TICKET_GENERATION_ATTEMPTS = 4;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

interface AttachmentArchiveTicketEntry {
  readonly connectionId: string;
  readonly expiresAt: number;
  readonly messageId: string;
  readonly purpose: typeof ATTACHMENT_ARCHIVE_TICKET_PURPOSE;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailAttachmentArchiveTickets?: Map<
    string,
    AttachmentArchiveTicketEntry
  >;
};

const tickets =
  globalState.__vedaMailAttachmentArchiveTickets ??
  new Map<string, AttachmentArchiveTicketEntry>();
globalState.__vedaMailAttachmentArchiveTickets = tickets;

const digestTicket = (ticket: string): string =>
  createHash("sha256").update(ticket, "utf8").digest("base64url");

const invalidTicket = (): ApiError =>
  new ApiError(
    "This attachment archive ticket is invalid or expired.",
    "ATTACHMENT_ARCHIVE_TICKET_INVALID",
    403,
  );

const ticketCapacityExceeded = (): ApiError =>
  new ApiError(
    "Too many attachment archive tickets are outstanding. Please try again shortly.",
    "ATTACHMENT_ARCHIVE_TICKET_BUSY",
    429,
  );

const cleanupExpiredTickets = (now: number): void => {
  for (const [digest, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(digest);
  }
};

const outstandingForConnection = (connectionId: string): number => {
  let count = 0;
  for (const entry of tickets.values()) {
    if (entry.connectionId === connectionId) count += 1;
  }
  return count;
};

interface AttachmentArchiveTicketBinding {
  readonly connectionId: string;
  readonly messageId: string;
}

export const issueAttachmentArchiveTicket = (
  binding: AttachmentArchiveTicketBinding,
): { readonly expiresAt: string; readonly ticket: string } => {
  const now = Date.now();
  cleanupExpiredTickets(now);
  if (
    tickets.size >= MAX_ATTACHMENT_ARCHIVE_TICKETS ||
    outstandingForConnection(binding.connectionId) >=
      MAX_ATTACHMENT_ARCHIVE_TICKETS_PER_CONNECTION
  ) {
    throw ticketCapacityExceeded();
  }

  const expiresAt = now + ATTACHMENT_ARCHIVE_TICKET_TTL_MS;
  for (let attempt = 0; attempt < MAX_TICKET_GENERATION_ATTEMPTS; attempt += 1) {
    const ticket = randomBytes(ATTACHMENT_ARCHIVE_TICKET_BYTES).toString(
      "base64url",
    );
    const digest = digestTicket(ticket);
    if (tickets.has(digest)) continue;
    tickets.set(digest, {
      connectionId: binding.connectionId,
      expiresAt,
      messageId: binding.messageId,
      purpose: ATTACHMENT_ARCHIVE_TICKET_PURPOSE,
    });
    return { expiresAt: new Date(expiresAt).toISOString(), ticket };
  }
  throw new ApiError(
    "An attachment archive ticket could not be created.",
    "ATTACHMENT_ARCHIVE_TICKET_UNAVAILABLE",
    503,
  );
};

export const consumeAttachmentArchiveTicket = (
  input: AttachmentArchiveTicketBinding & { readonly ticket: string },
): void => {
  const now = Date.now();
  cleanupExpiredTickets(now);
  if (!TICKET_PATTERN.test(input.ticket)) throw invalidTicket();

  const digest = digestTicket(input.ticket);
  const entry = tickets.get(digest);
  if (!entry) throw invalidTicket();

  // Delete before checking the binding so every presented ticket is single-use.
  tickets.delete(digest);
  if (
    entry.expiresAt <= now ||
    entry.connectionId !== input.connectionId ||
    entry.messageId !== input.messageId ||
    entry.purpose !== ATTACHMENT_ARCHIVE_TICKET_PURPOSE
  ) {
    throw invalidTicket();
  }
};

export const clearAttachmentArchiveTicketsForTests = (): void => {
  tickets.clear();
};
