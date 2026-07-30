import "server-only";

import { Readable } from "node:stream";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
} from "@/domain/mail/mail";
import { createBoundedAttachmentDownloadStream } from "@/infrastructure/providers/attachment-download-stream";
import {
  decodeScopedImapMessageId,
  imapUidValidityMatches,
} from "@/infrastructure/providers/imap-smtp/imap-codec";
import {
  closeImapClient,
  connectImapClient,
} from "@/infrastructure/providers/imap-smtp/imap-client";
import {
  findImapReceivedAttachment,
  imapAttachmentAccountScope,
} from "@/infrastructure/providers/imap-smtp/imap-received-attachment";
import type { ImapSmtpMemberConfig } from "@/infrastructure/providers/imap-smtp/imap-smtp.types";

const DOWNLOAD_CHUNK_BYTES = 64 * 1024;
const TIMEOUT_CODES = new Set([
  "ETIMEOUT",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "LockTimeout",
  "Timeout",
]);

const downloadError = (
  code: ConstructorParameters<typeof AttachmentDownloadError>[0],
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

const notFound = (): AttachmentDownloadError =>
  downloadError("not_found", "Attachment not found.");

const aborted = (): AttachmentDownloadError =>
  downloadError("aborted", "The attachment download was cancelled.");

export const isImapTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  return TIMEOUT_CODES.has(code) || error.name.toLowerCase().includes("timeout");
};

const mapProviderError = (
  error: unknown,
  signal?: AbortSignal,
): AttachmentDownloadError => {
  if (error instanceof AttachmentDownloadError) return error;
  if (signal?.aborted) return aborted();
  if (isImapTimeoutError(error)) {
    return downloadError(
      "timeout",
      "The mail provider attachment download timed out.",
    );
  }
  return downloadError(
    "provider_failure",
    "The mail provider could not download this attachment.",
  );
};

const assertDownloadInput = (input: AttachmentDownloadInput): void => {
  if (
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes <= 0 ||
    input.maxBytes >= Number.MAX_SAFE_INTEGER
  ) {
    throw downloadError(
      "invalid_request",
      "Attachment download limits were invalid.",
    );
  }
  if (input.signal?.aborted) throw aborted();
};

const decodeCanonicalMessageId = (
  config: ImapSmtpMemberConfig,
  messageId: AttachmentDownloadInput["messageId"],
) => {
  try {
    return decodeScopedImapMessageId(config, messageId);
  } catch {
    throw notFound();
  }
};

export const downloadImapAttachment = async (
  config: ImapSmtpMemberConfig,
  input: AttachmentDownloadInput,
): Promise<AttachmentDownload> => {
  assertDownloadInput(input);
  const reference = decodeCanonicalMessageId(config, input.messageId);
  const client = await connectImapClient(config, input.signal).catch(
    (error: unknown) => {
      throw mapProviderError(error, input.signal);
    },
  );
  let finalizePromise: Promise<void> | undefined;
  const finalize = async (): Promise<void> => {
    finalizePromise ??= (async () => {
      input.signal?.removeEventListener("abort", onAbort);
      await closeImapClient(client);
    })();
    await finalizePromise;
  };
  const onAbort = (): void => void finalize();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (input.signal?.aborted) throw aborted();
    const opened = await client.mailboxOpen(reference.mailbox, {
      readOnly: true,
    });
    if (input.signal?.aborted) throw aborted();
    if (!imapUidValidityMatches(reference, opened.uidValidity)) {
      throw notFound();
    }
    const message = await client.fetchOne(
      reference.uid,
      { bodyStructure: true, uid: true },
      { uid: true },
    );
    if (
      !message ||
      message.uid !== reference.uid ||
      !message.bodyStructure
    ) {
      throw notFound();
    }
    const attachment = findImapReceivedAttachment(
      {
        accountScope: imapAttachmentAccountScope(config),
        messageId: input.messageId,
        structure: message.bodyStructure,
        uidValidity: opened.uidValidity,
      },
      input.attachmentId,
    );
    if (!attachment) throw notFound();
    if (input.signal?.aborted) throw aborted();
    const downloaded = await client.download(
      reference.uid,
      attachment.part,
      {
        chunkSize: DOWNLOAD_CHUNK_BYTES,
        maxBytes: input.maxBytes + 1,
        uid: true,
      },
    );
    if (!downloaded?.content) {
      throw downloadError(
        "provider_failure",
        "The mail provider returned no attachment content.",
      );
    }
    const source = Readable.toWeb(
      downloaded.content,
    ) as ReadableStream<Uint8Array>;
    const body = createBoundedAttachmentDownloadStream({
      maxBytes: input.maxBytes,
      onFinalize: finalize,
      ...(input.signal ? { signal: input.signal } : {}),
      source,
    });
    return {
      body,
      mimeType: attachment.metadata.mimeType,
      name: attachment.metadata.name,
      size: null,
    };
  } catch (error) {
    await finalize();
    throw mapProviderError(error, input.signal);
  }
};
