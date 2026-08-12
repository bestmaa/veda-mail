import {
  ApiClientError,
  apiClientErrorFromResponse,
} from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

const endpoint = "/api/v1/member/portability/settings";

const fail = async (response: Response): Promise<never> => {
  const failure = await apiClientErrorFromResponse(
    response,
    `Settings transfer failed with status ${response.status}.`,
  );
  throw new ApiClientError(failure.message, failure.status, failure.code);
};

export const memberSettingsPortabilityApi = {
  async exportFile(sessionScope: string): Promise<Blob> {
    const response = await fetch(endpoint, {
      cache: "no-store",
      credentials: "same-origin",
      headers: mailSessionScopeHeaders(sessionScope),
      method: "GET",
    });
    if (!response.ok) return fail(response);
    return response.blob();
  },

  async importFile(contents: string, sessionScope: string): Promise<void> {
    const response = await fetch(endpoint, {
      body: contents,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...mailSessionScopeHeaders(sessionScope),
      },
      method: "POST",
    });
    if (!response.ok) return fail(response);
  },
};
