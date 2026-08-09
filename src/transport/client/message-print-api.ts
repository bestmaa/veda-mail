import type {
  MessagePrintDocument,
  MessagePrintScope,
} from "@/domain/mail/message-print";
import type { MessageId } from "@/domain/shared/brand";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const messagePrintApi = {
  create(
    messageId: MessageId,
    scope: MessagePrintScope,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<MessagePrintDocument>(
      `/api/v1/mail/messages/${encodeURIComponent(messageId)}/print`,
      {
        body: JSON.stringify({ scope }),
        headers: mailSessionScopeHeaders(sessionScope),
        method: "POST",
        ...(signal ? { signal } : {}),
      },
    );
  },
} as const;
