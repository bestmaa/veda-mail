import type {
  ComposeInput,
  MailWorkspace,
  MessageDetail,
  MessageMutation,
  SendReceipt,
} from "@/domain/mail/mail";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type {
  DraftId,
  MailboxId,
  MessageId,
  ProviderDraftId,
} from "@/domain/shared/brand";
import { attachmentApi } from "@/transport/client/attachment-api";
import {
  deleteResource,
  fetchData,
} from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export type MailApiSendInput = Omit<ComposeInput, "draftId"> & {
  readonly draftId: DraftId;
} & (
    | {
        readonly expectedDraftRevision?: never;
        readonly providerDraftId?: never;
      }
    | {
        readonly expectedDraftRevision: string;
        readonly providerDraftId: ProviderDraftId;
      }
  );

interface DraftUpdateInput {
  readonly composeId: DraftId;
  readonly content: DraftContent;
  readonly expectedRevision: string;
}

const draftEndpoint = (draftId?: ProviderDraftId): string =>
  `/api/v1/mail/drafts${
    draftId ? `/${encodeURIComponent(draftId)}` : ""
  }`;

export const mailApi = {
  ...attachmentApi,

  createDraft(
    composeId: DraftId,
    content: DraftContent,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<DraftDetail>(draftEndpoint(), {
      body: JSON.stringify({ composeId, content }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
      ...(signal ? { signal } : {}),
    });
  },

  deleteDraft(
    draftId: ProviderDraftId,
    expectedRevision: string,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return deleteResource(
      draftEndpoint(draftId),
      "Unable to discard this draft.",
      {
        body: JSON.stringify({ expectedRevision }),
        headers: {
          "Content-Type": "application/json",
          ...mailSessionScopeHeaders(sessionScope),
        },
        ...(signal ? { signal } : {}),
      },
    );
  },

  getDraft(
    draftId: ProviderDraftId,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<DraftDetail>(draftEndpoint(draftId), {
      headers: mailSessionScopeHeaders(sessionScope),
      ...(signal ? { signal } : {}),
    });
  },

  getMessage(messageId: MessageId, sessionScope: string) {
    return fetchData<MessageDetail>(
      `/api/v1/mail/messages/${encodeURIComponent(messageId)}`,
      { headers: mailSessionScopeHeaders(sessionScope) },
    );
  },

  getWorkspace(
    input: {
      readonly mailboxId?: MailboxId;
      readonly search?: string;
    },
    sessionScope?: string,
  ) {
    const params = new URLSearchParams();
    if (input.mailboxId) params.set("mailboxId", input.mailboxId);
    if (input.search) params.set("search", input.search);
    const query = params.size ? `?${params.toString()}` : "";
    return fetchData<MailWorkspace>(
      `/api/v1/mail/workspace${query}`,
      sessionScope
        ? { headers: mailSessionScopeHeaders(sessionScope) }
        : undefined,
    );
  },

  mutateMessage(mutation: MessageMutation, sessionScope: string) {
    return fetchData<{ readonly updated: boolean }>(
      `/api/v1/mail/messages/${encodeURIComponent(mutation.messageId)}`,
      {
        body: JSON.stringify(mutation),
        headers: mailSessionScopeHeaders(sessionScope),
        method: "PATCH",
      },
    );
  },

  sendMessage(
    input: MailApiSendInput,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<SendReceipt>("/api/v1/mail/send", {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
      ...(signal ? { signal } : {}),
    });
  },

  updateDraft(
    draftId: ProviderDraftId,
    input: DraftUpdateInput,
    sessionScope: string,
    signal?: AbortSignal,
  ) {
    return fetchData<DraftDetail>(draftEndpoint(draftId), {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PUT",
      ...(signal ? { signal } : {}),
    });
  },
};
