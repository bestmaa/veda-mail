import "server-only";

import { MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES, type MessageSourceDownload, type MessageSourceDownloadInput } from "@/domain/mail/message-source";
import { MessageSourceDownloadError } from "@/domain/mail/message-source-download-error";
import {
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const sourceStream = (source: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(source);
      controller.close();
    },
  });

export const downloadImapMessageSource = async (
  config: ImapSmtpMemberConfig,
  input: MessageSourceDownloadInput,
): Promise<MessageSourceDownload> => {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0 ||
    input.maxBytes > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES) {
    throw new MessageSourceDownloadError("invalid_request", "Message source download limit is invalid.");
  }
  if (input.signal?.aborted) {
    throw new MessageSourceDownloadError("aborted", "Message export was cancelled.");
  }
  let reference: ReturnType<typeof decodeScopedImapMessageId>;
  try {
    reference = decodeScopedImapMessageId(config, input.messageId);
  } catch {
    throw new MessageSourceDownloadError("not_found", "Message not found.");
  }
  return withImapClient(config, async (client) => {
    if (input.signal?.aborted) {
      throw new MessageSourceDownloadError("aborted", "Message export was cancelled.");
    }
    const opened = await client.mailboxOpen(reference.mailbox, {
      readOnly: true,
    });
    if (!imapUidValidityMatches(reference, opened.uidValidity)) {
      throw new MessageSourceDownloadError("not_found", "Message not found.");
    }
    const message = await client.fetchOne(
      reference.uid,
      { size: true, source: { maxLength: input.maxBytes + 1 }, uid: true },
      { uid: true },
    );
    if (!message || message.uid !== reference.uid || !message.source) {
      throw new MessageSourceDownloadError("not_found", "Message not found.");
    }
    const size = message.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new MessageSourceDownloadError("provider_failure", "Mail provider returned an invalid message size.");
    }
    if (size > input.maxBytes || message.source.byteLength > input.maxBytes) {
      throw new MessageSourceDownloadError("size_limit_exceeded", "Message source exceeds the download size limit.");
    }
    if (message.source.byteLength !== size) {
      throw new MessageSourceDownloadError("provider_failure", "Mail provider returned an incomplete message source.");
    }
    const bytes = new Uint8Array(message.source);
    return { body: sourceStream(bytes), size };
  });
};
