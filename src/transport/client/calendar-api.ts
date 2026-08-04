import type {
  CalendarEvent,
  CalendarInvitation,
  CalendarPart,
} from "@/domain/mail/calendar";
import type { SendReceipt } from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import {
  apiClientErrorFromResponse,
  fetchData,
} from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export interface CalendarInvitationItem {
  readonly canRespond: boolean;
  readonly canonicalIcs: string;
  readonly invitation: CalendarInvitation;
  readonly organizerMatchesSender: boolean | null;
  readonly part: CalendarPart;
}

export interface CalendarInvitationSnapshot {
  readonly invitations: readonly CalendarInvitationItem[];
  readonly invalidPartCount: number;
}

interface CalendarEventBookSnapshot {
  readonly createdAt: string | null;
  readonly events: readonly CalendarEvent[];
  readonly revision: string | null;
  readonly updatedAt: string | null;
  readonly version: 1;
}

export type CalendarResponseChoice = "accepted" | "declined" | "tentative";

const invitationEndpoint = (messageId: MessageId): string =>
  `/api/v1/mail/messages/${encodeURIComponent(messageId)}/calendar`;

export const calendarApi = {
  getInvitations(
    messageId: MessageId,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<CalendarInvitationSnapshot>(invitationEndpoint(messageId), {
      headers: mailSessionScopeHeaders(sessionScope),
      ...(signal ? { signal } : {}),
    });
  },

  async importEvent(ics: string, sessionScope: string) {
    const current = await fetchData<CalendarEventBookSnapshot>(
      "/api/v1/member/calendar",
      { headers: mailSessionScopeHeaders(sessionScope) },
    );
    return fetchData<CalendarEventBookSnapshot>("/api/v1/member/calendar", {
      body: JSON.stringify({
        expectedRevision: current.revision,
        ics,
        operation: "import-event",
      }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PUT",
    });
  },

  respond(
    messageId: MessageId,
    input: {
      readonly idempotencyKey: string;
      readonly partId: string;
      readonly response: CalendarResponseChoice;
    },
    sessionScope: string,
  ) {
    return fetchData<{
      readonly partId: string;
      readonly receipt: SendReceipt;
      readonly response: string;
      readonly sequence: number;
      readonly uid: string;
    }>(`${invitationEndpoint(messageId)}/respond`, {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
    });
  },

  async exportEvents(sessionScope: string): Promise<Blob> {
    const response = await fetch("/api/v1/member/calendar/ics", {
      headers: mailSessionScopeHeaders(sessionScope),
    });
    if (!response.ok) throw await apiClientErrorFromResponse(response);
    return response.blob();
  },
};
