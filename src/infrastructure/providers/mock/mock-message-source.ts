import "server-only";

import type { MessageDetail } from "@/domain/mail/mail";
import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES, type MessageSourceDownloadInput } from "@/domain/mail/message-source";
import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";

export const downloadMockMessageSource = (
  messages: readonly MessageDetail[],
  input: MessageSourceDownloadInput,
) => {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 ||
    input.maxBytes > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES) {
    throw new MessageSourceDownloadError(
      "invalid_request", "Message source download limit is invalid.",
    );
  }
  const message = messages.find((item) => item.id === input.messageId);
  if (!message) {
    throw new MessageSourceDownloadError("not_found", "Message not found.");
  }
  const source = new TextEncoder().encode([
    `From: ${message.from[0]?.email ?? "unknown@example.com"}`,
    `To: ${message.to[0]?.email ?? "unknown@example.com"}`,
    `Subject: ${message.subject.replace(/[\r\n]/gu, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    message.textBody,
  ].join("\r\n"));
  if (source.byteLength > input.maxBytes) {
    throw new MessageSourceDownloadError(
      "size_limit_exceeded",
      "Message source exceeds the download size limit.",
    );
  }
  return {
    body: new ReadableStream({ start(controller) {
      controller.enqueue(source); controller.close();
    } }),
    size: source.byteLength,
  };
};
