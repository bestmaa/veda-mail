import "server-only";

import type { CalendarEvent } from "@/domain/mail/calendar";
import { hasHeaderControlCharacter } from "@/domain/mail/header-safety";
import {
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import { z } from "zod";

export const MAX_CALENDAR_EVENTS_PER_OWNER = CALENDAR_LIMITS.eventsPerExport;
export const MAX_CALENDAR_EVENT_OWNERS = 10_000;
export const MAX_CALENDAR_EVENT_BOOK_BYTES = 16 * 1024 * 1024;

const timestampSchema = z.string().datetime();
const boundedText = (maximum: number) => z.string().max(maximum).refine(
  (value) => outgoingContentUtf8Bytes(value) <= maximum &&
    !hasUnpairedContentSurrogate(value) &&
    !hasDisallowedContentControl(value),
  "Calendar text contains unsafe characters.",
);
const singleLine = (maximum: number) => boundedText(maximum).refine(
  (value) => !/[\r\n\u2028\u2029]/u.test(value),
  "Calendar text must be one line.",
);

const timeZoneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("floating") }).strict(),
  z.object({
    id: singleLine(CALENDAR_LIMITS.textBytes).min(1),
    kind: z.literal("iana"),
  }).strict(),
  z.object({ kind: z.literal("utc") }).strict(),
]);

export const calendarTemporalValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("date"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  }).strict(),
  z.object({
    kind: z.literal("date-time"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u),
    zone: timeZoneSchema,
  }).strict(),
]);

const emailSchema = z.string().trim().max(320).email().refine(
  (value) => !hasHeaderControlCharacter(value),
  "Calendar email contains unsafe characters.",
);
const organizerSchema = z.object({
  email: emailSchema,
  name: singleLine(CALENDAR_LIMITS.textBytes).nullable(),
}).strict();
const attendeeSchema = organizerSchema.extend({
  participationStatus: z.enum([
    "ACCEPTED", "DECLINED", "DELEGATED", "NEEDS-ACTION", "TENTATIVE",
  ]),
  rsvp: z.boolean(),
}).strict();

export const calendarEventSchema = z.object({
  attendees: z.array(attendeeSchema).max(CALENDAR_LIMITS.attendeesPerEvent),
  description: boundedText(CALENDAR_LIMITS.descriptionBytes).nullable(),
  dtstamp: calendarTemporalValueSchema,
  duration: z.string().max(128).nullable(),
  endsAt: calendarTemporalValueSchema.nullable(),
  location: singleLine(CALENDAR_LIMITS.textBytes).nullable(),
  organizer: organizerSchema.nullable(),
  recurrenceId: calendarTemporalValueSchema.nullable(),
  recurrenceRule: z.object({
    canonical: singleLine(CALENDAR_LIMITS.textBytes).min(1),
    summary: singleLine(CALENDAR_LIMITS.textBytes).min(1),
  }).strict().nullable(),
  sequence: z.number().int().nonnegative().max(2_147_483_647),
  startsAt: calendarTemporalValueSchema,
  summary: singleLine(CALENDAR_LIMITS.summaryBytes),
  uid: singleLine(CALENDAR_LIMITS.uidBytes).min(1),
}).strict();

export const calendarEventIdentity = (
  event: Pick<CalendarEvent, "recurrenceId" | "uid">,
): string => `${event.uid}\0${JSON.stringify(event.recurrenceId)}`;

export const compareCalendarEvents = (
  left: Pick<CalendarEvent, "recurrenceId" | "uid">,
  right: Pick<CalendarEvent, "recurrenceId" | "uid">,
): number => calendarEventIdentity(left).localeCompare(calendarEventIdentity(right));

export const storedCalendarEventBookSchema = z.object({
  createdAt: timestampSchema,
  events: z.array(calendarEventSchema).max(MAX_CALENDAR_EVENTS_PER_OWNER),
  revision: z.string().min(16).max(200),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().superRefine((book, context) => {
  const keys = book.events.map(calendarEventIdentity);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", message: "Calendar event identities must be unique." });
  }
  if (book.events.some((event, index) =>
    index > 0 && compareCalendarEvents(book.events[index - 1]!, event) >= 0)) {
    context.addIssue({ code: "custom", message: "Calendar events must be canonically ordered." });
  }
  if (outgoingContentUtf8Bytes(JSON.stringify(book)) > MAX_CALENDAR_EVENT_BOOK_BYTES) {
    context.addIssue({ code: "custom", message: "The calendar-event book is too large." });
  }
});

export const encryptedCalendarEventBookSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  ciphertext: z.string().min(1).max(32 * 1024 * 1024),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
}).strict();

export const calendarEventFileSchema = z.object({
  owners: z.record(
    z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    encryptedCalendarEventBookSchema,
  ),
  updatedAt: timestampSchema,
  version: z.literal(1),
}).strict().refine(
  (file) => Object.keys(file.owners).length <= MAX_CALENDAR_EVENT_OWNERS,
  "The calendar-event store contains too many owners.",
);

export interface CalendarEventBook {
  readonly createdAt: string | null;
  readonly events: readonly CalendarEvent[];
  readonly revision: string | null;
  readonly updatedAt: string | null;
  readonly version: 1;
}

export type StoredCalendarEventBook = CalendarEventBook & {
  readonly createdAt: string;
  readonly revision: string;
  readonly updatedAt: string;
};
export type CalendarEventFile = z.infer<typeof calendarEventFileSchema>;
export type EncryptedCalendarEventBook = CalendarEventFile["owners"][string];

export const parseStoredCalendarEventBook = (
  value: unknown,
): StoredCalendarEventBook =>
  storedCalendarEventBookSchema.parse(value) as StoredCalendarEventBook;

export const emptyCalendarEventBook = (): CalendarEventBook => ({
  createdAt: null,
  events: [],
  revision: null,
  updatedAt: null,
  version: 1,
});
