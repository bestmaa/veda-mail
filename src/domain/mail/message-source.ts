import type { MessageId } from "@/domain/shared/brand";

export const MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface MessageSourceDownloadInput {
  readonly maxBytes: number;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
}

export interface MessageSourceDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
}
