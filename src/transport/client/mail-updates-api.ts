import type { MailUpdateWaitResult } from "@/domain/mail/mail-update";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export const mailUpdatesApi = {
  wait(sessionScope: string, signal: AbortSignal) {
    return fetchData<MailUpdateWaitResult>("/api/v1/mail/updates", {
      headers: mailSessionScopeHeaders(sessionScope),
      signal,
    });
  },
};
