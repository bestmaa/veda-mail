import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import { findJmapReceivedAttachment } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import {
  jmapAttachmentEmailSchema,
  jmapListResultSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export const downloadStalwartMessageAttachment = async (
  client: StalwartJmapClient,
  accountId: string,
  input: AttachmentDownloadInput,
): Promise<AttachmentDownload> => {
  const response = await client.request(
    [
      [
        "Email/get",
        {
          accountId,
          ids: [input.messageId],
          properties: ["id", "attachments"],
        },
        "attachment-email",
      ],
    ],
    [JMAP_MAIL],
  );
  const result = client.result(
    response,
    "attachment-email",
    "Email/get",
    jmapListResultSchema(jmapAttachmentEmailSchema),
  );
  const email = result.list[0];
  const responseMatchesRequest =
    result.accountId === accountId && email?.id === input.messageId;
  const attachment =
    email && responseMatchesRequest
      ? findJmapReceivedAttachment(accountId, email, input.attachmentId)
      : null;
  if (!responseMatchesRequest || !attachment) {
    throw new AttachmentDownloadError("not_found", "Attachment not found.");
  }
  if (attachment.metadata.size > input.maxBytes) {
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
