import "server-only";

import {
  MAX_MESSAGE_SOURCE_IMPORT_BYTES,
  type MessageSourceImportInput,
  type MessageSourceImportResult,
} from "@/domain/mail/message-source";
import { MessageSourceImportError } from "@/domain/mail/message-source-import-error";
import { id } from "@/domain/shared/brand";
import {
  decodeMailboxId,
  encodeScopedImapMessageId,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import { withImapClient } from "@/infrastructure/providers/imap-smtp/imap-client";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

export const importImapMessageSource = async (
  config: ImapSmtpMemberConfig,
  input: MessageSourceImportInput,
): Promise<MessageSourceImportResult> => {
  if (input.source.byteLength < 1 ||
      input.source.byteLength > MAX_MESSAGE_SOURCE_IMPORT_BYTES) {
    throw new MessageSourceImportError(
      "size_limit_exceeded",
      "Message source is empty or exceeds the import limit.",
    );
  }
  if (input.signal?.aborted) {
    throw new MessageSourceImportError("aborted", "Message import was cancelled.");
  }
  let mailbox: string;
  try {
    mailbox = decodeMailboxId(input.mailboxId);
  } catch {
    throw new MessageSourceImportError("mailbox_not_found", "Mailbox not found.");
  }
  return withImapClient(config, async (client) => {
    const opened = await client.mailboxOpen(mailbox);
    const appended = await client.append(mailbox, Buffer.from(input.source));
    if (!appended || !appended.uid) {
      throw new MessageSourceImportError(
        "provider_failure",
        "Mail provider did not return the imported message identity.",
      );
    }
    return { messageId: id.message(encodeScopedImapMessageId(config, {
      mailbox,
      uid: appended.uid,
      uidValidity: appended.uidValidity ?? opened.uidValidity,
    })) };
  });
};
