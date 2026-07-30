import type { UploadedAttachment } from "@/domain/mail/mail";
import { MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES } from "@/domain/mail/received-attachment";
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

const readBoundedPreviewText = async (
  response: Response,
  declaredLength: number,
): Promise<string> => {
  if (!response.body) {
    throw new Error("The attachment preview returned no content.");
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(declaredLength);
  let offset = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength > declaredLength - offset) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The attachment preview exceeded its safe size.");
      }
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== declaredLength) {
    throw new Error("The attachment preview was incomplete.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The attachment preview returned invalid text.");
  }
};

const archivePreflightFailure = (status: number): string => {
  const messages: Readonly<Record<number, string>> = {
    401: "Please sign in again before downloading attachments.",
    404: "The message or one of its attachments is no longer available.",
    409: "This message does not have attachments to download.",
    413: "These attachments are too large to download together.",
    429: "Another archive is busy. Please try again shortly.",
    502: "The mail provider could not prepare these attachments.",
    504: "The mail provider took too long. Please try again.",
  };
  return messages[status] ?? `Unable to prepare this ZIP (status ${status}).`;
};

export const attachmentApi = {
  async previewAttachment(
    href: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await fetch(href, {
      body: JSON.stringify({ renderer: "text" }),
      cache: "no-store",
      headers: {
        Accept: "text/plain",
        "Content-Type": "application/json",
      },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    await assertOk(response);
    if (
      response.headers.get("content-type")?.toLowerCase() !==
      "text/plain; charset=utf-8"
    ) {
      const error = new Error(
        "The attachment preview returned an unsafe type.",
      );
      await response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 1 ||
      declaredLength > MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES
    ) {
      const error = new Error(
        "The attachment preview returned an invalid size.",
      );
      await response.body?.cancel(error).catch(() => undefined);
      throw error;
    }
    return readBoundedPreviewText(response, declaredLength);
  },

  async preflightAttachmentArchive(
    href: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(href, {
      method: "HEAD",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(archivePreflightFailure(response.status));
  },

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
