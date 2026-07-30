import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  MessageAttachmentListInput,
  MessageAttachmentMetadata,
} from "@/domain/mail/mail";
import {
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import {
  closeImapClient,
  connectImapClient,
} from "@/infrastructure/providers/imap-smtp/imap-client";
import { isImapTimeoutError } from "@/infrastructure/providers/imap-smtp/imap-attachment-download";
import {
  classifyImapMessagePresentation,
  parseImapMessagePresentation,
} from "@/infrastructure/providers/imap-smtp/imap-message-presentation";
import {
  bindImapReceivedAttachments,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const IMAP_PRESENTATION_MAX_BYTES = 5_000_000;

const attachmentListError = (
  code: "aborted" | "not_found" | "provider_failure" | "timeout",
): AttachmentDownloadError =>
  new AttachmentDownloadError(
    code,
    code === "aborted"
      ? "The attachment lookup was cancelled."
      : code === "not_found"
        ? "Message not found."
        : code === "timeout"
          ? "The mail provider attachment lookup timed out."
          : "The mail provider could not list message attachments.",
  );

const providerErrorCode = (
  error: unknown,
  signal?: AbortSignal,
): "aborted" | "provider_failure" | "timeout" =>
  signal?.aborted
    ? "aborted"
    : isImapTimeoutError(error)
      ? "timeout"
      : "provider_failure";

const awaitWithSignal = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(attachmentListError("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
};

export const listImapMessageAttachments = async (
  config: ImapSmtpMemberConfig,
  input: MessageAttachmentListInput,
): Promise<readonly MessageAttachmentMetadata[]> => {
  if (input.signal?.aborted) throw attachmentListError("aborted");
  let reference: ReturnType<typeof decodeScopedImapMessageId>;
  try {
    reference = decodeScopedImapMessageId(config, input.messageId);
  } catch {
    throw attachmentListError("not_found");
  }
  const client = await connectImapClient(config, input.signal).catch(
    (error: unknown) => {
      if (error instanceof AttachmentDownloadError) throw error;
      throw attachmentListError(providerErrorCode(error, input.signal));
    },
  );
  const onAbort = (): void => {
    try {
      client.close();
    } catch {
      // The raced provider operation is normalized below.
    }
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (input.signal?.aborted) throw attachmentListError("aborted");
    const opened = await awaitWithSignal(
      client.mailboxOpen(reference.mailbox, { readOnly: true }),
      input.signal,
    );
    if (!imapUidValidityMatches(reference, opened.uidValidity)) {
      throw attachmentListError("not_found");
    }
    const message = await awaitWithSignal(
      client.fetchOne(
        reference.uid,
        {
          bodyStructure: true,
          source: { maxLength: IMAP_PRESENTATION_MAX_BYTES },
          uid: true,
        },
        { uid: true },
      ),
      input.signal,
    );
    if (
      !message ||
      message.uid !== reference.uid ||
      !message.bodyStructure ||
      !message.source
    ) {
      throw attachmentListError("not_found");
    }
    const receivedAttachments = bindImapReceivedAttachments({
      accountScope: imapAttachmentAccountScope(config),
      messageId: input.messageId,
      structure: message.bodyStructure,
      uidValidity: opened.uidValidity,
    });
    const parsed = await parseImapMessagePresentation(message.source);
    if (input.signal?.aborted) throw attachmentListError("aborted");
    return classifyImapMessagePresentation(
      parsed,
      receivedAttachments,
    ).attachments.filter(
      (attachment) => attachment.disposition === "attachment",
    );
  } catch (error) {
    if (error instanceof AttachmentDownloadError) throw error;
    throw attachmentListError(providerErrorCode(error, input.signal));
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    await closeImapClient(client);
  }
};
