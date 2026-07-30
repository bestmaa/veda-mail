import type { UploadedAttachment } from "@/domain/mail/mail";
import type {
  AttachmentId,
  AttachmentUploadId,
  DraftId,
  MessageId,
} from "@/domain/shared/brand";

interface ApiEnvelope<TData> {
  readonly data: TData;
}

const failureMessage = async (response: Response): Promise<string> => {
  const payload = (await response.json().catch(() => ({}))) as {
    readonly error?: { readonly message?: string };
  };
  return (
    payload.error?.message ?? `Request failed with status ${response.status}.`
  );
};

const assertOk = async (response: Response): Promise<void> => {
  if (!response.ok) throw new Error(await failureMessage(response));
};

export const attachmentApi = {
  async getAttachmentCapability(): Promise<{
    readonly maxAttachmentBytes: number | null;
    readonly status: "available" | "unavailable" | "unsupported";
  }> {
    const response = await fetch("/api/v1/mail/attachments/capability");
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
    signal?: AbortSignal,
  ): Promise<UploadedAttachment> {
    const reserved = await fetch("/api/v1/mail/attachments", {
      body: JSON.stringify({
        declaredMimeType: file.type || "application/octet-stream",
        draftId,
        fileName: file.name,
        size: file.size,
      }),
      headers: { "Content-Type": "application/json" },
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
        },
        method: "PUT",
        ...(signal ? { signal } : {}),
      });
      await assertOk(response);
      return ((await response.json()) as ApiEnvelope<UploadedAttachment>).data;
    } catch (error) {
      await fetch(reservation.data.uploadUrl, {
        headers: { "X-Veda-Draft-Id": draftId },
        method: "DELETE",
      }).catch(() => undefined);
      throw error;
    }
  },

  async importAttachment(
    draftId: DraftId,
    messageId: MessageId,
    attachmentId: AttachmentId,
    signal?: AbortSignal,
  ): Promise<UploadedAttachment> {
    const response = await fetch(
      `/api/v1/mail/messages/${encodeURIComponent(
        messageId,
      )}/attachments/${encodeURIComponent(attachmentId)}/imports`,
      {
        body: JSON.stringify({ draftId }),
        headers: { "Content-Type": "application/json" },
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
  ): Promise<void> {
    const response = await fetch(
      `/api/v1/mail/attachments/${encodeURIComponent(
        attachmentId,
      )}?draftId=${encodeURIComponent(draftId)}`,
      { method: "DELETE" },
    );
    await assertOk(response);
  },
};
