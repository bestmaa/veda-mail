import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import {
  JmapAttachmentTransport,
  JmapAttachmentTransportError,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import type { JmapReceivedAttachment } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import type { JmapSession } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

interface DownloadJmapReceivedAttachmentInput
  extends Pick<
    AttachmentDownloadInput,
    "maxBytes" | "messageId" | "signal"
  > {
  readonly accountId: string;
  readonly attachment: JmapReceivedAttachment;
  readonly authorizationHeader: () => Promise<string>;
  readonly baseUrl: string;
  readonly session: JmapSession;
}

const normalizeError = (error: unknown): AttachmentDownloadError => {
  if (!(error instanceof JmapAttachmentTransportError)) {
    return new AttachmentDownloadError(
      "provider_failure",
      "The mail provider could not download this attachment.",
    );
  }
  if (error.code === "aborted") {
    return new AttachmentDownloadError(
      "aborted",
      "The attachment download was cancelled.",
    );
  }
  if (error.code === "timeout") {
    return new AttachmentDownloadError(
      "timeout",
      "The mail provider attachment download timed out.",
    );
  }
  if (error.code === "size_limit_exceeded") {
    return new AttachmentDownloadError(
      "size_limit_exceeded",
      "The attachment exceeds the download size limit.",
    );
  }
  if (error.code === "provider_http_error" && error.httpStatus === 404) {
    return new AttachmentDownloadError("not_found", "Attachment not found.");
  }
  return new AttachmentDownloadError(
    "provider_failure",
    "The mail provider could not download this attachment.",
  );
};

export const downloadJmapReceivedAttachment = async (
  input: DownloadJmapReceivedAttachmentInput,
): Promise<AttachmentDownload> => {
  const origin = (await assertSafeProviderOrigin(input.baseUrl)).origin;
  const transport = new JmapAttachmentTransport({
    authorizationHeader: input.authorizationHeader,
    baseUrl: origin,
    downloadUrl: input.session.downloadUrl,
    maxDownloadBytes: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
    maxUploadBytes: 1,
    uploadUrl: input.session.uploadUrl,
  });
  const metadata = input.attachment.metadata;
  const handle = transport.bindMessageAttachment({
    accountId: input.accountId,
    fileName: metadata.name,
    mediaType: metadata.mimeType,
    messageId: input.messageId,
    providerBlobId: input.attachment.providerBlobId,
    size: metadata.size,
  });
  try {
    const downloaded = await transport.download({
      attachment: handle,
      maxBytes: input.maxBytes,
      messageId: input.messageId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return {
      body: downloaded.body,
      mimeType: metadata.mimeType,
      name: metadata.name,
      size: metadata.size,
    };
  } catch (error) {
    throw normalizeError(error);
  }
};
