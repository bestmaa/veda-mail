import type {
  ComposeInput,
  MailWorkspace,
  MessageDetail,
  MessageMutation,
  SendReceipt,
} from "@/domain/mail/mail";
import type { DraftId, MailboxId, MessageId } from "@/domain/shared/brand";
import { attachmentApi } from "@/transport/client/attachment-api";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const mailApi = {
  ...attachmentApi,

  getMessage(messageId: MessageId, sessionScope: string) {
    return fetchData<MessageDetail>(
      `/api/v1/mail/messages/${encodeURIComponent(messageId)}`,
      { headers: mailSessionScopeHeaders(sessionScope) },
    );
  },

  getWorkspace(
    input: {
      readonly mailboxId?: MailboxId;
      readonly search?: string;
    },
    sessionScope?: string,
  ) {
    const params = new URLSearchParams();
    if (input.mailboxId) params.set("mailboxId", input.mailboxId);
    if (input.search) params.set("search", input.search);
    const query = params.size ? `?${params.toString()}` : "";
    return fetchData<MailWorkspace>(
      `/api/v1/mail/workspace${query}`,
      sessionScope
        ? { headers: mailSessionScopeHeaders(sessionScope) }
        : undefined,
    );
  },

  mutateMessage(mutation: MessageMutation, sessionScope: string) {
    return fetchData<{ readonly updated: boolean }>(
      `/api/v1/mail/messages/${encodeURIComponent(mutation.messageId)}`,
      {
        body: JSON.stringify(mutation),
        headers: mailSessionScopeHeaders(sessionScope),
        method: "PATCH",
      },
    );
  },

  sendMessage(
    input: ComposeInput & { readonly draftId: DraftId },
    sessionScope: string,
  ) {
    return fetchData<SendReceipt>("/api/v1/mail/send", {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
    });
  },
};
