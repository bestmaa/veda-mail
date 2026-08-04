import type {
  SnoozeBulkItem,
  SnoozeBulkResult,
  SnoozedMessageBook,
  SnoozeCapability,
} from "@/domain/mail/snooze";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export interface SnoozeWorkspaceSnapshot {
  readonly book: SnoozedMessageBook;
  readonly capability: SnoozeCapability;
}

const endpoint = "/api/v1/mail/snoozed";
const request = <T>(sessionScope: string, path: string, init: RequestInit): Promise<T> =>
  fetchData<T>(path, {
    cache: "no-store", credentials: "same-origin", ...init,
    headers: { ...mailSessionScopeHeaders(sessionScope), ...init.headers },
  });

export const snoozeApi = {
  get(sessionScope: string, signal?: AbortSignal) {
    return request<SnoozeWorkspaceSnapshot>(sessionScope, endpoint, {
      method: "GET", ...(signal ? { signal } : {}),
    });
  },
  create(items: readonly SnoozeBulkItem[], sessionScope: string) {
    return request<SnoozeBulkResult>(sessionScope, endpoint, {
      body: JSON.stringify({ items }), headers: { "Content-Type": "application/json" }, method: "POST",
    });
  },
  reschedule(snoozeId: string, wakeAt: string, sessionScope: string) {
    return request<SnoozedMessageBook>(sessionScope, `${endpoint}/${encodeURIComponent(snoozeId)}`, {
      body: JSON.stringify({ wakeAt }), headers: { "Content-Type": "application/json" }, method: "PATCH",
    });
  },
  restore(snoozeId: string, sessionScope: string) {
    return request<SnoozedMessageBook>(sessionScope, `${endpoint}/${encodeURIComponent(snoozeId)}/restore`, {
      method: "POST",
    });
  },
  retry(snoozeId: string, sessionScope: string) {
    return request<SnoozedMessageBook>(sessionScope, `${endpoint}/${encodeURIComponent(snoozeId)}/retry`, {
      method: "POST",
    });
  },
};
