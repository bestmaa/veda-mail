import "server-only";

import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES, type MessageSourceDownload, type MessageSourceDownloadInput } from "@/domain/mail/message-source";
import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";
import { createJmapResponseStream } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-response";
import { resolveJmapAttachmentUrl } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-url";
import { requestJmapAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-request";
import type { StalwartJmapClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.client";
import {
  jmapListResultSchema,
  jmapMessageSourceSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { JMAP_MAIL } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export const downloadStalwartMessageSource = async (
  client: StalwartJmapClient,
  accountId: string,
  input: MessageSourceDownloadInput,
): Promise<MessageSourceDownload> => {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 ||
    input.maxBytes > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES) {
    throw new MessageSourceDownloadError("invalid_request", "Message source download limit is invalid.");
  }
  const response = await client.request(
    [["Email/get", {
      accountId,
      ids: [input.messageId],
      properties: ["id", "blobId", "size"],
    }, "source"]],
    [JMAP_MAIL],
    input.signal,
  );
  const result = client.result(
    response,
    "source",
    "Email/get",
    jmapListResultSchema(jmapMessageSourceSchema),
  );
  const message = result.list[0];
  if (
    result.accountId !== accountId ||
    result.list.length !== 1 ||
    message?.id !== input.messageId
  ) {
    throw new MessageSourceDownloadError("not_found", "Message not found.");
  }
  if (message.size > input.maxBytes) {
    throw new MessageSourceDownloadError("size_limit_exceeded", "Message source exceeds the download size limit.");
  }
  const session = await client.getSession(input.signal);
  const endpoint = await resolveJmapAttachmentUrl(
    session.apiUrl,
    session.downloadUrl,
    "download",
    {
      accountId,
      blobId: message.blobId,
      name: "message.eml",
      type: "message/rfc822",
    },
  );
  const download = await requestJmapAttachment(
    endpoint,
    {
      headers: {
        Accept: "message/rfc822",
        "Accept-Encoding": "identity",
        Authorization: await client.authorizationForProviderTransport(),
      },
      method: "GET",
    },
    input.signal,
  );
  return {
    body: createJmapResponseStream(download, {
      expectedBytes: message.size,
      maxBytes: input.maxBytes,
      requireContentLength: false,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
    size: message.size,
  };
};
