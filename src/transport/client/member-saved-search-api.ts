import type { SavedSearchBook, SavedSearchPutOperation } from "@/domain/mail/saved-search";
import { ApiClientError, apiClientErrorFromResponse } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export class MemberSavedSearchApiError extends ApiClientError {
  public constructor(message: string, status: number, code = "UNKNOWN_ERROR") {
    super(message, status, code); this.name = "MemberSavedSearchApiError";
  }
}
interface ApiEnvelope<T> { readonly data: T }
const endpoint = "/api/v1/member/saved-searches";
const fail = async (response: Response): Promise<never> => {
  const failure = await apiClientErrorFromResponse(response, `Saved-search request failed with status ${response.status}.`);
  throw new MemberSavedSearchApiError(failure.message, failure.status, failure.code);
};
const request = async (sessionScope: string, init: RequestInit): Promise<SavedSearchBook> => {
  const response = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", ...init,
    headers: { ...mailSessionScopeHeaders(sessionScope), ...init.headers } });
  if (!response.ok) return fail(response);
  return ((await response.json()) as ApiEnvelope<SavedSearchBook>).data;
};
export const memberSavedSearchApi = {
  get: (sessionScope: string, signal?: AbortSignal) => request(sessionScope,
    { method: "GET", ...(signal ? { signal } : {}) }),
  put: (operation: SavedSearchPutOperation, sessionScope: string, signal?: AbortSignal) => request(sessionScope,
    { body: JSON.stringify(operation), headers: { "Content-Type": "application/json" }, method: "PUT", ...(signal ? { signal } : {}) }),
};
