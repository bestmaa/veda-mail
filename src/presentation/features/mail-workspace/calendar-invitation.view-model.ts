import type {
  CalendarInvitation,
  CalendarPart,
} from "@/domain/mail/calendar";

export interface CalendarInvitationViewItem {
  readonly canRespond: boolean;
  readonly canonicalIcs: string;
  readonly invitation: CalendarInvitation;
  readonly organizerMatchesSender: boolean | null;
  readonly part: CalendarPart;
}

export interface CalendarInvitationViewSnapshot {
  readonly invitations: readonly CalendarInvitationViewItem[];
  readonly invalidPartCount: number;
}

export type CalendarInvitationResponseChoice =
  | "accepted"
  | "declined"
  | "tentative";
