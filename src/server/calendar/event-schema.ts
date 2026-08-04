import type { CalendarTemporalValue } from "@/domain/mail/calendar";
import {
  type CalendarEventPutOperation,
} from "@/server/calendar/event-book";
import { CALENDAR_LIMITS } from "@/server/calendar/calendar-limits";
import {
  calendarTemporalValueSchema,
} from "@/server/calendar/event-record";
import { z } from "zod";

export const MAX_CALENDAR_IMPORT_REQUEST_BYTES = CALENDAR_LIMITS.inputBytes + 4_096;

const revisionSchema = z.string().trim().min(16).max(200).nullable();
const uidSchema = z.string().min(1).max(CALENDAR_LIMITS.uidBytes).refine(
  (value) => ![...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029;
  }),
  "Calendar UID contains unsafe characters.",
);

export const calendarEventMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    expectedRevision: revisionSchema,
    ics: z.string().min(1).max(CALENDAR_LIMITS.inputBytes),
    operation: z.literal("import-event"),
  }).strict(),
  z.object({
    expectedRevision: revisionSchema,
    operation: z.literal("remove-event"),
    recurrenceId: calendarTemporalValueSchema.nullable(),
    uid: uidSchema,
  }).strict(),
]);

export type CalendarEventRouteOperation = z.infer<
  typeof calendarEventMutationSchema
>;

export const parseCalendarEventRouteOperation = (
  value: unknown,
): CalendarEventRouteOperation => calendarEventMutationSchema.parse(value);

export const removeCalendarEventOperation = (
  operation: Extract<CalendarEventRouteOperation, { operation: "remove-event" }>,
): CalendarEventPutOperation => ({
  ...operation,
  recurrenceId: operation.recurrenceId as CalendarTemporalValue | null,
});
