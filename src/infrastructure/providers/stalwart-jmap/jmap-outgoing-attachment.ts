import "server-only";

import type { OutgoingAttachment } from "@/domain/mail/mail";
import {
  JmapAttachmentTransport,
  type JmapProviderUploadReference,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";
import {
  JMAP_CORE,
  type JmapSession,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export const maximumJmapUploadBytes = (session: JmapSession): number => {
  const core = session.capabilities[JMAP_CORE];
  if (
    typeof core !== "object" ||
    !core ||
    !("maxSizeUpload" in core) ||
    typeof core.maxSizeUpload !== "number" ||
    !Number.isSafeInteger(core.maxSizeUpload) ||
    core.maxSizeUpload < 0
  ) {
    throw new Error("Mail provider returned an invalid JMAP upload limit.");
  }
  return Math.min(MAX_ATTACHMENT_BYTES, core.maxSizeUpload);
};

export const uploadJmapOutgoingAttachment = async (input: {
  readonly accountId: string;
  readonly attachment: OutgoingAttachment;
  readonly authorizationHeader: () => Promise<string>;
  readonly baseUrl: string;
  readonly session: JmapSession;
}): Promise<JmapProviderUploadReference> => {
  const origin = (await assertSafeProviderOrigin(input.baseUrl)).origin;
  const maximum = maximumJmapUploadBytes(input.session);
  if (input.attachment.size > maximum) {
    throw new Error("Attachment exceeds the JMAP upload limit.");
  }
  const transport = new JmapAttachmentTransport({
    authorizationHeader: input.authorizationHeader,
    baseUrl: origin,
    downloadUrl: input.session.downloadUrl,
    maxDownloadBytes: MAX_ATTACHMENT_BYTES,
    maxUploadBytes: maximum,
    uploadUrl: input.session.uploadUrl,
  });
  const handle = await transport.upload({
    accountId: input.accountId,
    body: input.attachment.content,
    contentLength: input.attachment.size,
    fileName: input.attachment.name,
    mediaType: input.attachment.mimeType,
  });
  return transport.providerUploadReference(handle);
};
