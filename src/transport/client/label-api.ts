import type {
  LabelColor,
  MailLabel,
  MailLabelDeletion,
} from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

const endpoint = "/api/v1/mail/labels";

export const labelApi = {
  createLabel(
    input: { readonly color: LabelColor; readonly name: string },
    sessionScope: string,
  ) {
    return fetchData<{ readonly labels: readonly MailLabel[] }>(endpoint, {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
    });
  },

  deleteLabel(labelId: LabelId, sessionScope: string) {
    return fetchData<{
      readonly deletion: MailLabelDeletion;
      readonly done: boolean;
      readonly labels: readonly MailLabel[];
    }>(endpoint, {
      body: JSON.stringify({ labelId }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "DELETE",
    });
  },

  updateLabel(
    input: {
      readonly color?: LabelColor;
      readonly labelId: LabelId;
      readonly name?: string;
    },
    sessionScope: string,
  ) {
    return fetchData<{ readonly labels: readonly MailLabel[] }>(endpoint, {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PATCH",
    });
  },
};
