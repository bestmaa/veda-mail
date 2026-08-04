import type {
  ContactBook,
  ContactPutOperation,
} from "@/domain/member/contact";
import {
  ApiClientError,
  apiClientErrorFromResponse,
} from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export class MemberContactApiError extends ApiClientError {
  public constructor(
    message: string,
    status: number,
    code = "UNKNOWN_ERROR",
  ) {
    super(message, status, code);
    this.name = "MemberContactApiError";
  }
}

interface ApiEnvelope<TData> {
  readonly data: TData;
}

const endpoint = "/api/v1/member/contacts";
const vcardEndpoint = `${endpoint}/vcard`;

const contactApiError = async (response: Response): Promise<never> => {
  const failure = await apiClientErrorFromResponse(
    response,
    `Contact request failed with status ${response.status}.`,
  );
  throw new MemberContactApiError(
    failure.message,
    failure.status,
    failure.code,
  );
};

const contactBook = async (
  sessionScope: string,
  init: RequestInit,
  requestEndpoint = endpoint,
): Promise<ContactBook> => {
  const response = await fetch(requestEndpoint, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...mailSessionScopeHeaders(sessionScope),
      ...init.headers,
    },
  });
  if (!response.ok) {
    return contactApiError(response);
  }
  return ((await response.json()) as ApiEnvelope<ContactBook>).data;
};

export const memberContactApi = {
  async exportVCard(sessionScope: string, signal?: AbortSignal): Promise<Blob> {
    const response = await fetch(vcardEndpoint, {
      cache: "no-store",
      credentials: "same-origin",
      headers: mailSessionScopeHeaders(sessionScope),
      method: "GET",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return contactApiError(response);
    return response.blob();
  },

  get(sessionScope: string, signal?: AbortSignal) {
    return contactBook(sessionScope, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  },

  put(
    operation: ContactPutOperation,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return contactBook(sessionScope, {
      body: JSON.stringify(operation),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
  },

  importVCard(
    vcard: string,
    expectedRevision: string | null,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return contactBook(sessionScope, {
      body: JSON.stringify({ expectedRevision, vcard }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      ...(signal ? { signal } : {}),
    }, vcardEndpoint);
  },
};
