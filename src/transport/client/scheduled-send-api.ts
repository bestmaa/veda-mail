import type {
  ScheduledMessageBook,
  ScheduledMessagePurpose,
  ScheduleMessageResult,
} from "@/domain/mail/scheduled-send";
import type { ScheduledMessageId } from "@/domain/shared/brand";
import type { MailApiSendInput } from "@/transport/client/mail-api";
import { deleteResource, fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

const endpoint = (messageId?: ScheduledMessageId): string =>
  `/api/v1/mail/scheduled${
    messageId ? `/${encodeURIComponent(messageId)}` : ""
  }`;

export const scheduledSendApi = {
  cancelScheduledMessage(
    messageId: ScheduledMessageId,
    sessionScope: string,
  ) {
    return deleteResource(
      endpoint(messageId),
      "Unable to cancel this scheduled message.",
      { headers: mailSessionScopeHeaders(sessionScope) },
    );
  },

  getScheduledMessages(sessionScope: string) {
    return fetchData<ScheduledMessageBook>(endpoint(), {
      headers: mailSessionScopeHeaders(sessionScope),
    });
  },

  rescheduleMessage(
    messageId: ScheduledMessageId,
    scheduledAt: string,
    sessionScope: string,
  ) {
    return fetchData<ScheduledMessageBook>(endpoint(messageId), {
      body: JSON.stringify({ scheduledAt }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PATCH",
    });
  },

  scheduleMessage(
    request: MailApiSendInput,
    scheduledAt: string,
    sessionScope: string,
    purpose: ScheduledMessagePurpose = "scheduled",
  ) {
    return fetchData<ScheduleMessageResult>(endpoint(), {
      body: JSON.stringify({ purpose, request, scheduledAt }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
    });
  },
};
