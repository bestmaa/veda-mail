import type { MailboxId, MessageId } from "@/domain/shared/brand";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const messageSourceImportApi = {
  import(file: File, mailboxId: MailboxId | string, sessionScope: string) {
    const query = new URLSearchParams({ mailboxId });
    return fetchData<{ readonly messageId: MessageId }>(
      `/api/v1/mail/messages/import?${query.toString()}`,
      {
        body: file,
        headers: {
          "Content-Type": "message/rfc822",
          ...mailSessionScopeHeaders(sessionScope),
        },
        method: "POST",
      },
    );
  },
};
