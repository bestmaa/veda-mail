import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  Attachment,
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import type { MessageId } from "@/domain/shared/brand";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { findJmapReceivedAttachment } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import { mapVisibleMessageAttachments } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.mapper";
import {
  jmapAttachmentEmailSchema,
  jmapListResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import {
  JMAP_MAIL,
  JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
  MAX_JMAP_BODY_VALUE_BYTES,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export const normalizeStalwartAttachmentLookupError = (
  error: unknown,
  signal?: AbortSignal,
): AttachmentDownloadError => {
  if (error instanceof AttachmentDownloadError) return error;
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new AttachmentDownloadError(
      "aborted",
      "The attachment lookup was cancelled.",
    );
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new AttachmentDownloadError(
      "timeout",
      "The mail provider attachment lookup timed out.",
    );
  }
  return new AttachmentDownloadError(
    "provider_failure",
    "The mail provider could not list message attachments.",
  );
};

const getAttachmentEmail = async (
  client: StalwartJmapClient,
  accountId: string,
  messageId: MessageId,
  includeHtmlBodyValues: boolean,
  signal?: AbortSignal,
) => {
  try {
    const bodyValueArguments = includeHtmlBodyValues
      ? {
          fetchHTMLBodyValues: true,
          maxBodyValueBytes: MAX_JMAP_BODY_VALUE_BYTES,
          properties: ["id", "attachments", "htmlBody", "bodyValues"],
        }
      : { properties: ["id", "attachments", "htmlBody"] };
    const response = await client.request(
      [
        [
          "Email/get",
          {
            accountId,
            bodyProperties: JMAP_RECEIVED_ATTACHMENT_BODY_PROPERTIES,
            ids: [messageId],
            ...bodyValueArguments,
          },
          "attachment-email",
        ],
      ],
      [JMAP_MAIL],
      signal,
    );
    const result = client.result(
      response,
      "attachment-email",
      "Email/get",
      jmapListResultSchema(jmapAttachmentEmailSchema),
    );
    const email = result.list[0];
    const responseMatchesRequest =
      result.accountId === accountId &&
      result.list.length === 1 &&
      email?.id === messageId;
    if (!responseMatchesRequest || !email) {
      throw new AttachmentDownloadError("not_found", "Attachment not found.");
    }
    return email;
  } catch (error) {
    throw normalizeStalwartAttachmentLookupError(error, signal);
  }
};

export const listStalwartMessageAttachments = async (
  client: StalwartJmapClient,
  accountId: string,
  input: { readonly messageId: MessageId; readonly signal?: AbortSignal },
): Promise<readonly Attachment[]> =>
  mapVisibleMessageAttachments(
    await getAttachmentEmail(
      client,
      accountId,
      input.messageId,
      true,
      input.signal,
    ),
    accountId,
  );

export const downloadStalwartMessageAttachment = async (
  client: StalwartJmapClient,
  accountId: string,
  input: AttachmentDownloadInput,
): Promise<AttachmentDownload> => {
  const email = await getAttachmentEmail(
    client,
    accountId,
    input.messageId,
    false,
    input.signal,
  );
  const attachment = findJmapReceivedAttachment(
    accountId,
    email,
    input.attachmentId,
  );
  if (!attachment) {
    throw new AttachmentDownloadError("not_found", "Attachment not found.");
  }
  if (
    attachment.metadata.size !== null &&
    attachment.metadata.size > input.maxBytes
  ) {
    throw new AttachmentDownloadError(
      "size_limit_exceeded",
      "The attachment exceeds the download size limit.",
    );
  }
  return client.downloadAttachment({
    accountId,
    attachment,
    maxBytes: input.maxBytes,
    messageId: input.messageId,
    ...(input.signal ? { signal: input.signal } : {}),
  });
};
