import type {
  EmailSignatureBook,
  EmailSignaturePutOperation,
} from "@/domain/member/email-signature";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export class MemberSignatureApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code = "UNKNOWN_ERROR",
  ) {
    super(message);
    this.name = "MemberSignatureApiError";
  }
}

const endpoint = "/api/v1/member/signatures";

const signatureBook = async (
  init: RequestInit,
): Promise<EmailSignatureBook> => {
  const response = await fetch(endpoint, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
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
  get(signal?: AbortSignal) {
    return signatureBook({
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  },

  put(operation: EmailSignaturePutOperation, signal?: AbortSignal) {
    return signatureBook({
      body: JSON.stringify(operation),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
  },
};
