import type { ConversationPage } from "@/domain/mail/conversation";
import type { MessageId } from "@/domain/shared/brand";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const conversationApi = {
  getConversation(
    messageId: MessageId,
    sessionScope: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const query = params.size ? `?${params.toString()}` : "";
    return fetchData<ConversationPage>(
      `/api/v1/mail/messages/${encodeURIComponent(messageId)}/conversation${query}`,
      {
        headers: mailSessionScopeHeaders(sessionScope),
        ...(signal ? { signal } : {}),
      },
    );
  },
} as const;
