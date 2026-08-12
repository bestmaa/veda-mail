import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import {
  MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
  MAX_MESSAGE_SOURCE_ARCHIVE_BYTES,
  MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES,
  type MessageSourceDownload,
} from "@/domain/mail/message-source";
import type { MessageId } from "@/domain/shared/brand";
import {
  createZipCentralEntry,
  createZipDataDescriptor,
  createZipEnd,
  createZipLocalHeader,
  finishZipCrc32,
  updateZipCrc32,
  type ZipCentralEntry,
} from "@/server/mail/attachment-archive-zip";
import type { AttachmentDownloadLease } from "@/server/mail/attachment-download-concurrency";
import { ApiError } from "@/transport/http/api-error";

export { MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES } from "@/domain/mail/message-source";
const TIMEOUT_MS = 10 * 60_000;

const fail = (message: string, code: string, status: number): never => {
  throw new ApiError(message, code, status);
};
const addBytes = (current: number, amount: number): number => {
  const next = current + amount;
  if (!Number.isSafeInteger(next) || next > MAX_MESSAGE_SOURCE_ARCHIVE_BYTES) {
    return fail("Selected messages are too large to export together.", "MESSAGE_EXPORT_TOO_LARGE", 413);
  }
  return next;
};
const validateDownload = (download: MessageSourceDownload): void => {
  if (!Number.isSafeInteger(download.size) || download.size < 0 ||
      download.size > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES) {
    return fail("Mail provider returned an invalid message size.", "MESSAGE_EXPORT_PROVIDER_FAILED", 502);
  }
};

const archiveBytes = async function* (input: {
  readonly first: MessageSourceDownload;
  readonly mail: MailApplicationService;
  readonly messageIds: readonly MessageId[];
  readonly signal: AbortSignal;
}): AsyncGenerator<Uint8Array> {
  const central: ZipCentralEntry[] = [];
  let outputBytes = 0;
  let payloadBytes = 0;
  for (const [index, messageId] of input.messageIds.entries()) {
    if (input.signal.aborted) return fail("Message export was cancelled.", "MESSAGE_EXPORT_ABORTED", 499);
    const download = index === 0 ? input.first : await input.mail.downloadMessageSource({
      maxBytes: MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
      messageId,
      signal: input.signal,
    });
    validateDownload(download);
    const name = `message-${String(index + 1).padStart(3, "0")}.eml`;
    const localOffset = outputBytes;
    const header = createZipLocalHeader(name);
    outputBytes = addBytes(outputBytes, header.byteLength);
    yield header;
    const reader = download.body.getReader();
    let entryBytes = 0;
    let crc = 0xffffffff;
    let complete = false;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (input.signal.aborted) return fail("Message export was cancelled.", "MESSAGE_EXPORT_ABORTED", 499);
        entryBytes += chunk.value.byteLength;
        payloadBytes = addBytes(payloadBytes, chunk.value.byteLength);
        outputBytes = addBytes(outputBytes, chunk.value.byteLength);
        if (entryBytes > download.size || entryBytes > MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES) {
          return fail("Mail provider returned invalid message bytes.", "MESSAGE_EXPORT_PROVIDER_FAILED", 502);
        }
        crc = updateZipCrc32(crc, chunk.value);
        yield chunk.value;
      }
      if (entryBytes !== download.size) {
        return fail("Mail provider returned an incomplete message.", "MESSAGE_EXPORT_PROVIDER_FAILED", 502);
      }
      complete = true;
    } finally {
      if (!complete) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const crc32 = finishZipCrc32(crc);
    const descriptor = createZipDataDescriptor(crc32, entryBytes);
    outputBytes = addBytes(outputBytes, descriptor.byteLength);
    yield descriptor;
    central.push({ crc32, localOffset, name, size: entryBytes });
  }
  const centralOffset = outputBytes;
  for (const entry of central) {
    const encoded = createZipCentralEntry(entry);
    outputBytes = addBytes(outputBytes, encoded.byteLength);
    yield encoded;
  }
  const end = createZipEnd(central.length, outputBytes - centralOffset, centralOffset);
  addBytes(outputBytes, end.byteLength);
  yield end;
};

export const prepareMessageSourceArchive = async (input: {
  readonly lease: AttachmentDownloadLease;
  readonly mail: MailApplicationService;
  readonly messageIds: readonly MessageId[];
  readonly requestSignal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> => {
  if (!input.messageIds.length || input.messageIds.length > MAX_MESSAGE_SOURCE_ARCHIVE_ENTRIES ||
      new Set(input.messageIds).size !== input.messageIds.length) {
    input.lease.release();
    return fail("Choose 1 to 20 unique messages.", "MESSAGE_EXPORT_SELECTION_INVALID", 400);
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([input.requestSignal, controller.signal, AbortSignal.timeout(TIMEOUT_MS)]);
  let first: MessageSourceDownload | undefined;
  try {
    first = await input.mail.downloadMessageSource({
      maxBytes: MAX_MESSAGE_SOURCE_DOWNLOAD_BYTES,
      messageId: input.messageIds[0]!,
      signal,
    });
    validateDownload(first);
    const iterator = archiveBytes({ first, mail: input.mail, messageIds: input.messageIds, signal });
    let finalized = false;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      input.lease.release();
    };
    return new ReadableStream({
      cancel(reason) { controller.abort(reason); void iterator.return(undefined); finalize(); },
      async pull(stream) {
        try {
          const next = await iterator.next();
          if (next.done) { stream.close(); finalize(); }
          else stream.enqueue(next.value);
        } catch (error) { controller.abort(error); stream.error(error); finalize(); }
      },
    }, { highWaterMark: 0 });
  } catch (error) {
    await first?.body.cancel(error).catch(() => undefined);
    input.lease.release();
    throw error;
  }
};
