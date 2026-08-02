import type {
  EmailTemplateBook,
  EmailTemplatePutOperation,
} from "@/domain/member/email-template";
import { ApiClientError } from "@/transport/client/api-request";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export class MemberTemplateApiError extends ApiClientError {
  public constructor(
    message: string,
    status: number,
    code = "UNKNOWN_ERROR",
  ) {
    super(message, status, code);
    this.name = "MemberTemplateApiError";
  }
}

const endpoint = "/api/v1/member/templates";
const sessionScopeHeader = "x-veda-mail-session-scope";

const templateBook = async (
  sessionScope: string,
  init: RequestInit,
): Promise<EmailTemplateBook> => {
  const response = await fetch(endpoint, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      [sessionScopeHeader]: sessionScope,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const failure = (await response
      .json()
      .catch(() => ({}))) as ApiErrorEnvelope;
    throw new MemberTemplateApiError(
      failure.error?.message ??
        `Template request failed with status ${response.status}.`,
      response.status,
      failure.error?.code,
    );
  }
  return ((await response.json()) as ApiEnvelope<EmailTemplateBook>).data;
};

export const memberTemplateApi = {
  get(sessionScope: string, signal?: AbortSignal) {
    return templateBook(sessionScope, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  },

  put(
    operation: EmailTemplatePutOperation,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return templateBook(sessionScope, {
      body: JSON.stringify(operation),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
  },
};
