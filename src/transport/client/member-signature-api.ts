import type {
  EmailSignatureBook,
  EmailSignaturePutOperation,
} from "@/domain/member/email-signature";
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

export class MemberSignatureApiError extends ApiClientError {
  public constructor(
    message: string,
    status: number,
    code = "UNKNOWN_ERROR",
  ) {
    super(message, status, code);
    this.name = "MemberSignatureApiError";
  }
}

const endpoint = "/api/v1/member/signatures";
const sessionScopeHeader = "x-veda-mail-session-scope";

const signatureBook = async (
  sessionScope: string,
  init: RequestInit,
): Promise<EmailSignatureBook> => {
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
    throw new MemberSignatureApiError(
      failure.error?.message ??
        `Signature request failed with status ${response.status}.`,
      response.status,
      failure.error?.code,
    );
  }
  return ((await response.json()) as ApiEnvelope<EmailSignatureBook>).data;
};

export const memberSignatureApi = {
  get(sessionScope: string, signal?: AbortSignal) {
    return signatureBook(sessionScope, {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  },

  put(
    operation: EmailSignaturePutOperation,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return signatureBook(sessionScope, {
      body: JSON.stringify(operation),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
  },
};
