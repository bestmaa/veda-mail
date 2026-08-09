import type {
  VacationResponseUpdate,
  VacationWorkspace,
} from "@/domain/mail/vacation";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

const endpoint = "/api/v1/member/vacation";
const headers = (sessionScope: string) => mailSessionScopeHeaders(sessionScope);

export const memberVacationApi = {
  get(sessionScope: string, signal?: AbortSignal) {
    return fetchData<VacationWorkspace>(endpoint, {
      cache: "no-store", headers: headers(sessionScope), method: "GET",
      ...(signal ? { signal } : {}),
    });
  },
  put(input: VacationResponseUpdate, sessionScope: string) {
    return fetchData<NonNullable<VacationWorkspace["response"]>>(endpoint, {
      body: JSON.stringify(input), headers: headers(sessionScope), method: "PUT",
    });
  },
};
