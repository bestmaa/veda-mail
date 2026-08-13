import type {
  DelegationEntry,
  DelegationUpdate,
  DelegationWorkspace,
} from "@/domain/mail/delegation";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

const endpoint = "/api/v1/member/delegation";
const headers = (sessionScope: string) => mailSessionScopeHeaders(sessionScope);

export const memberDelegationApi = {
  delete(identifier: string, sessionScope: string) {
    return fetchData<readonly DelegationEntry[]>(endpoint, {
      body: JSON.stringify({ identifier }), headers: headers(sessionScope), method: "DELETE",
    });
  },
  get(sessionScope: string, signal?: AbortSignal) {
    return fetchData<DelegationWorkspace>(endpoint, {
      cache: "no-store", headers: headers(sessionScope), method: "GET",
      ...(signal ? { signal } : {}),
    });
  },
  put(input: DelegationUpdate, sessionScope: string) {
    return fetchData<readonly DelegationEntry[]>(endpoint, {
      body: JSON.stringify(input), headers: headers(sessionScope), method: "PUT",
    });
  },
};
