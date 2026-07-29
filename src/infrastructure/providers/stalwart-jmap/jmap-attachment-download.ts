import "server-only";

import {
  createJmapAttachmentHandle,
  createJmapAttachmentId,
  readJmapAttachmentSecret,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-handle";
import {
  assertJmapAttachmentMetadata,
  assertJmapText,
  invalidAttachmentInput,
  jmapAuthorization,
  requestJmapAttachment,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-request";
import { createJmapResponseStream } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-response";
import { throwIfAttachmentAborted } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-stream";
import type {
  JmapAttachmentHandle,
  JmapAttachmentTransportConfig,
  JmapBindMessageAttachmentInput,
  JmapDownloadedAttachment,
  JmapDownloadAttachmentInput,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { resolveJmapAttachmentUrl } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-url";

export const bindJmapMessageAttachment = (
  input: JmapBindMessageAttachmentInput,
  owner: object,
): JmapAttachmentHandle => {
  assertJmapText(input.accountId, 1_024);
  assertJmapText(input.messageId, 1_024);
  assertJmapText(input.providerBlobId, 1_024);
  assertJmapAttachmentMetadata(input.fileName, input.mediaType, input.size);
  return createJmapAttachmentHandle(
    {
      attachmentId: createJmapAttachmentId(input.providerBlobId),
      fileName: input.fileName,
      mediaType: input.mediaType,
      size: input.size,
    },
    {
      accountId: input.accountId,
      blobId: input.providerBlobId,
      kind: "message",
      messageId: input.messageId,
      owner,
    },
  );
};

export const downloadJmapAttachment = async (
  config: JmapAttachmentTransportConfig,
  input: JmapDownloadAttachmentInput,
  owner: object,
  onFinalize?: () => Promise<void> | void,
): Promise<JmapDownloadedAttachment> => {
  throwIfAttachmentAborted(input.signal);
  const secret = readJmapAttachmentSecret(input.attachment, owner);
  if (!secret || secret.kind !== "message") {
    throw new JmapAttachmentTransportError(
      "invalid_handle",
      "The attachment handle was invalid.",
    );
  }
  if (secret.messageId !== input.messageId) {
    throw new JmapAttachmentTransportError(
      "scope_mismatch",
      "The attachment does not belong to this message.",
    );
  }
  const maxBytes = input.maxBytes ?? config.maxDownloadBytes;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > config.maxDownloadBytes
  ) {
    throw invalidAttachmentInput();
  }
  if (input.attachment.size > maxBytes) {
    throw new JmapAttachmentTransportError(
      "size_limit_exceeded",
      "The attachment exceeds the configured size limit.",
    );
  }
  const endpoint = await resolveJmapAttachmentUrl(
    config.baseUrl,
    config.downloadUrl,
    "download",
    {
      accountId: secret.accountId,
      blobId: secret.blobId,
      name: input.attachment.fileName,
      type: input.attachment.mediaType,
    },
  );
  const response = await requestJmapAttachment(
    endpoint,
    {
      headers: {
        Accept: input.attachment.mediaType,
        "Accept-Encoding": "identity",
        Authorization: await jmapAuthorization(config, input.signal),
      },
      method: "GET",
    },
    input.signal,
  );
  const body = createJmapResponseStream(response, {
    expectedBytes: input.attachment.size,
    maxBytes,
    ...(onFinalize ? { onFinalize } : {}),
    requireContentLength: true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return Object.freeze({
    ...input.attachment.toJSON(),
    body,
  });
};
