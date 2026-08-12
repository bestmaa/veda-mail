import type { MailboxId, MessageId } from "@/domain/shared/brand";

export const MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_MESSAGE_SOURCE_IMPORT_BYTES = 18 * 1024 * 1024;
export const MAX_MESSAGE_SOURCE_ARCHIVE_BYTES = 250 * 1024 * 1024;
export const MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES = 20;

export interface MessageSourceDownloadInput {
  readonly maxBytes: number;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
}

export interface MessageSourceDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
}

export interface MessageSourceImportInput {
  readonly mailboxId: MailboxId;
  readonly source: Uint8Array;
  readonly signal?: AbortSignal;
}

export interface MessageSourceImportResult {
  readonly messageId: MessageId;
}
