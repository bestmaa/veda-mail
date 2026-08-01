import type { UploadedAttachment } from "@/domain/mail/mail";
import type {
  AttachmentId,
  AttachmentUploadId,
  DraftId,
  MessageId,
} from "@/domain/shared/brand";
import {
  downloadAttachmentArchive,
  preflightAttachmentArchive,
} from "@/transport/client/attachment-archive-client";
import { saveAttachmentResponse } from "@/transport/client/attachment-download-client";
import { readAttachmentPreviewResponse } from "@/transport/client/attachment-preview-client";
import { apiClientErrorFromResponse } from "@/transport/client/api-request";
import { fetchInlineImage } from "@/transport/client/inline-image-api";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

const assertOk = async (response: Response): Promise<void> => {
  if (!response.ok) throw await apiClientErrorFromResponse(response);
};

export const attachmentApi = {
  fetchInlineImage,
  downloadAttachmentArchive,
  preflightAttachmentArchive,

  async previewAttachment(
    href: string,
    sessionScope: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await fetch(href, {
      body: JSON.stringify({ renderer: "text" }),
      cache: "no-store",
      headers: {
        Accept: "text/plain",
        "Content-Type": "application/json",
        ...mailSessionScopeHeaders(sessionScope),
      },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    await assertOk(response);
    return readAttachmentPreviewResponse(response);
  },

  async downloadAttachment(
    href: string,
    fileName: string,
    sessionScope: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(href, {
      cache: "no-store",
      credentials: "same-origin",
      headers: mailSessionScopeHeaders(sessionScope),
      redirect: "error",
      referrerPolicy: "no-referrer",
      ...(signal ? { signal } : {}),
    });
    await assertOk(response);
    await saveAttachmentResponse(response, fileName);
  },

  async getAttachmentCapability(sessionScope: string): Promise<{
    readonly maxAttachmentBytes: number | null;
    readonly status: "available" | "unavailable" | "unsupported";
  }> {
    const response = await fetch("/api/v1/mail/attachments/capability", {
      headers: mailSessionScopeHeaders(sessionScope),
    });
    await assertOk(response);
    return (
      (await response.json()) as ApiEnvelope<{
        readonly maxAttachmentBytes: number | null;
        readonly status: "available" | "unavailable" | "unsupported";
      }>
    ).data;
  },

  async addAttachment(
    draftId: DraftId,
    file: File,
    sessionScope: string,
    signal?: AbortSignal,
  ): Promise<UploadedAttachment> {
    const reserved = await fetch("/api/v1/mail/attachments", {
      body: JSON.stringify({
        declaredMimeType: file.type || "application/octet-stream",
        draftId,
        fileName: file.name,
        size: file.size,
      }),
      headers: {
        "Content-Type": "application/json",
        ...mailSessionScopeHeaders(sessionScope),
      },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    await assertOk(reserved);
    const reservation = (await reserved.json()) as ApiEnvelope<{
      readonly id: AttachmentUploadId;
      readonly uploadUrl: string;
    }>;
    try {
      const response = await fetch(reservation.data.uploadUrl, {
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Veda-Draft-Id": draftId,
          ...mailSessionScopeHeaders(sessionScope),
        },
        method: "PUT",
        ...(signal ? { signal } : {}),
      });
      await assertOk(response);
      return ((await response.json()) as ApiEnvelope<UploadedAttachment>).data;
    } catch (error) {
      await fetch(reservation.data.uploadUrl, {
        headers: {
          "X-Veda-Draft-Id": draftId,
          ...mailSessionScopeHeaders(sessionScope),
        },
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  },

  async importAttachment(
    draftId: DraftId,
    messageId: MessageId,
    attachmentId: AttachmentId,
    sessionScope: string,
    signal?: AbortSignal,
  ): Promise<UploadedAttachment> {
    const response = await fetch(
      `/api/v1/mail/messages/${encodeURIComponent(
        messageId,
      )}/attachments/${encodeURIComponent(attachmentId)}/imports`,
      {
        body: JSON.stringify({ draftId }),
        headers: {
          "Content-Type": "application/json",
          ...mailSessionScopeHeaders(sessionScope),
        },
        method: "POST",
        ...(signal ? { signal } : {}),
      },
    );
    await assertOk(response);
    return ((await response.json()) as ApiEnvelope<UploadedAttachment>).data;
  },

  async removeAttachment(
    draftId: DraftId,
    attachmentId: AttachmentUploadId,
    sessionScope: string,
  ): Promise<void> {
    const response = await fetch(
      `/api/v1/mail/attachments/${encodeURIComponent(
        attachmentId,
      )}?draftId=${encodeURIComponent(draftId)}`,
      {
        headers: mailSessionScopeHeaders(sessionScope),
        method: "DELETE",
      },
    );
    await assertOk(response);
  },
};
