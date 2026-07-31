import { API_ERROR_CODE_HEADER } from "@/transport/http/api-error";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

interface ApiErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code = "UNKNOWN_ERROR",
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const apiClientErrorFromResponse = async (
  response: Response,
  fallback?: string,
): Promise<ApiClientError> => {
  const failure = (await response
    .json()
    .catch(() => ({}))) as ApiErrorEnvelope;
  return new ApiClientError(
    failure.error?.message ??
      fallback ??
      `Request failed with status ${response.status}.`,
    response.status,
    failure.error?.code ??
      response.headers.get(API_ERROR_CODE_HEADER) ??
      undefined,
  );
};

export const fetchData = async <TData>(
  input: string,
  init?: RequestInit,
): Promise<TData> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw await apiClientErrorFromResponse(response);
  }
  return ((await response.json()) as ApiEnvelope<TData>).data;
};

export const deleteResource = async (
  input: string,
  message: string,
  init?: RequestInit,
): Promise<void> => {
  const response = await fetch(input, { ...init, method: "DELETE" });
  if (!response.ok) {
    throw await apiClientErrorFromResponse(response, message);
  }
};
