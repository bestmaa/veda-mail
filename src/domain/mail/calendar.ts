import type { MessageId } from "@/domain/shared/brand";

declare const calendarPartIdBrand: unique symbol;

export type CalendarPartId = string & {
  readonly [calendarPartIdBrand]: "CalendarPartId";
};

export const asCalendarPartId = (value: string): CalendarPartId =>
  value as CalendarPartId;

export interface CalendarPart {
  readonly id: CalendarPartId;
  readonly mimeType: "text/calendar";
  readonly name: string;
  readonly size: number | null;
}

export interface CalendarPartListInput {
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
}

export interface CalendarPartDownloadInput extends CalendarPartListInput {
  readonly calendarPartId: CalendarPartId;
  readonly maxBytes: number;
}

export interface CalendarPartDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly mimeType: "text/calendar";
  readonly name: string;
  readonly size: number | null;
}

export type CalendarMethod = "CANCEL" | "PUBLISH" | "REPLY" | "REQUEST";

export type CalendarTimeZone =
  | { readonly kind: "floating" }
  | { readonly kind: "iana"; readonly id: string }
  | { readonly kind: "utc" };

export type CalendarTemporalValue =
  | { readonly kind: "date"; readonly value: string }
  | {
      readonly kind: "date-time";
      readonly value: string;
      readonly zone: CalendarTimeZone;
    };

export type CalendarParticipationStatus =
  | "ACCEPTED"
  | "DECLINED"
  | "DELEGATED"
  | "NEEDS-ACTION"
  | "TENTATIVE";

export interface CalendarOrganizer {
  readonly email: string;
  readonly name: string | null;
}

export interface CalendarAttendee extends CalendarOrganizer {
  readonly participationStatus: CalendarParticipationStatus;
  readonly rsvp: boolean;
}

export interface CalendarRecurrenceRule {
  readonly canonical: string;
  readonly summary: string;
}

export interface CalendarEvent {
  readonly attendees: readonly CalendarAttendee[];
  readonly description: string | null;
  readonly dtstamp: CalendarTemporalValue;
  readonly duration: string | null;
  readonly endsAt: CalendarTemporalValue | null;
  readonly location: string | null;
  readonly organizer: CalendarOrganizer | null;
  readonly recurrenceId: CalendarTemporalValue | null;
  readonly recurrenceRule: CalendarRecurrenceRule | null;
  readonly sequence: number;
  readonly startsAt: CalendarTemporalValue;
  readonly summary: string;
  readonly uid: string;
}

export interface CalendarInvitation {
  readonly event: CalendarEvent;
  readonly method: CalendarMethod;
  readonly productId: string | null;
}

export type CalendarReplyParticipationStatus =
  | "ACCEPTED"
  | "DECLINED"
  | "TENTATIVE";

export interface CalendarReplyInput {
  readonly attendeeEmail: string;
  readonly invitation: CalendarInvitation;
  readonly participationStatus: CalendarReplyParticipationStatus;
  readonly respondedAt?: Date;
}
