import type {
  BulkMessageMutation,
  BulkMessageMutationResult,
  ComposeInput,
  MailWorkspace,
  Mailbox,
  MessageDetail,
  MessageMutation,
  SendReceipt,
} from "@/domain/mail/mail";
import type { MailboxColor } from "@/domain/mail/mailbox";
import type { MailboxEmptyUpdate } from "@/domain/mail/mailbox-empty";
import type { DraftContent, DraftDetail } from "@/domain/mail/draft";
import type {
  DraftId,
  MailboxId,
  MessageId,
  ProviderDraftId,
} from "@/domain/shared/brand";
import { attachmentApi } from "@/transport/client/attachment-api";
import { labelApi } from "@/transport/client/label-api";
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

export interface MailboxApiMutationResult {
  readonly appearanceSaved: boolean;
  readonly mailboxId: MailboxId | null;
  readonly mailboxes: readonly Mailbox[];
}

const draftEndpoint = (draftId?: ProviderDraftId): string =>
  `/api/v1/mail/drafts${
    draftId ? `/${encodeURIComponent(draftId)}` : ""
  }`;

export const mailApi = {
  ...attachmentApi,
  ...labelApi,

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

  createMailbox(
    input: {
      readonly color: MailboxColor;
      readonly name: string;
      readonly parentId: MailboxId | null;
    },
    sessionScope: string,
  ) {
    return fetchData<MailboxApiMutationResult>("/api/v1/mail/mailboxes", {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
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

  deleteMailbox(mailboxId: MailboxId, sessionScope: string) {
    return fetchData<MailboxApiMutationResult>("/api/v1/mail/mailboxes", {
      body: JSON.stringify({ mailboxId }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "DELETE",
    });
  },

  emptyMailbox(mailboxId: MailboxId, sessionScope: string) {
    return fetchData<MailboxEmptyUpdate>("/api/v1/mail/mailboxes/empty", {
      body: JSON.stringify({ mailboxId }),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "POST",
    });
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
      readonly cursor?: string;
      readonly mailboxId?: MailboxId;
      readonly search?: string;
    },
    sessionScope?: string,
  ) {
    const params = new URLSearchParams();
    if (input.cursor) params.set("cursor", input.cursor);
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

  mutateMessages(mutation: BulkMessageMutation, sessionScope: string) {
    return fetchData<BulkMessageMutationResult>(
      "/api/v1/mail/messages/bulk",
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

  updateMailbox(
    input: {
      readonly color?: MailboxColor;
      readonly mailboxId: MailboxId;
      readonly name?: string;
      readonly parentId?: MailboxId | null;
    },
    sessionScope: string,
  ) {
    return fetchData<MailboxApiMutationResult>("/api/v1/mail/mailboxes", {
      body: JSON.stringify(input),
      headers: mailSessionScopeHeaders(sessionScope),
      method: "PATCH",
    });
  },

};
