import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MessageAttachmentListInput,
  MessageDetail,
} from "@/domain/mail/mail";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import {
  assertMockAttachmentDownloadInput,
  createMockAttachmentStream,
  throwIfMockAttachmentAborted,
} from "@/infrastructure/providers/mock/mock-attachment-download";

type AttachmentContents = ReadonlyMap<
  MessageId,
  ReadonlyMap<AttachmentId, Uint8Array>
>;

export const listMockMessageAttachments = (
  messages: readonly MessageDetail[],
  input: MessageAttachmentListInput,
) => {
  throwIfMockAttachmentAborted(input.signal);
  const message = messages.find((item) => item.id === input.messageId);
  if (!message) {
    throw new AttachmentDownloadError("not_found", "Message not found.");
  }
  return structuredClone(message.attachments);
};

export const downloadMockMessageAttachment = async (
  messages: readonly MessageDetail[],
  contents: AttachmentContents,
  input: AttachmentDownloadInput,
): Promise<AttachmentDownload> => {
  assertMockAttachmentDownloadInput(input.maxBytes, input.signal);
  const message = messages.find((item) => item.id === input.messageId);
  const attachment = message?.attachments.find(
    (item) => item.id === input.attachmentId,
  );
  if (!message || !attachment) {
    throw new AttachmentDownloadError("not_found", "Attachment not found.");
  }
  if (attachment.size > input.maxBytes) {
    throw new AttachmentDownloadError(
      "size_limit_exceeded",
      "Attachment exceeds the download byte limit.",
    );
  }
  const content = contents.get(message.id)?.get(attachment.id);
  if (!content || content.byteLength !== attachment.size) {
    throw new AttachmentDownloadError(
      "provider_failure",
      "Attachment content is unavailable.",
    );
  }
  throwIfMockAttachmentAborted(input.signal);
  return {
    body: createMockAttachmentStream(
      content.slice(),
      input.maxBytes,
      input.signal,
    ),
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: content.byteLength,
  };
};
