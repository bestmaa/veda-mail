import "server-only";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { MAX_ATTACHMENT_ARCHIVE_BYTES, MAX_ATTACHMENT_ARCHIVE_OUTPUT_BYTES } from "@/domain/mail/attachment-archive-limits";
export { MAX_ATTACHMENT_ARCHIVE_BYTES, MAX_ATTACHMENT_ARCHIVE_ENTRIES, MAX_ATTACHMENT_ARCHIVE_OUTPUT_BYTES } from "@/domain/mail/attachment-archive-limits";
import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  MessageAttachmentMetadata,
} from "@/domain/mail/mail";
import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
import type { MessageId } from "@/domain/shared/brand";
import {
  attachmentArchiveAbortError,
  type AttachmentArchiveSource,
  ownAttachmentArchiveSource,
  readAttachmentArchiveSource,
} from "@/server/mail/attachment-archive-source";
import {
  createZipCentralEntry,
  createZipDataDescriptor,
  createZipEnd,
  createZipLocalHeader,
  finishZipCrc32,
  updateZipCrc32,
  type ZipCentralEntry,
} from "@/server/mail/attachment-archive-zip";
const MAX_EMPTY_CHUNKS_PER_ENTRY = 32;

export interface AttachmentArchiveEntry {
  readonly attachment: MessageAttachmentMetadata;
  readonly name: string;
}

export interface AttachmentArchiveStreamOptions {
  readonly downloadAttachment: (
    input: AttachmentDownloadInput,
  ) => Promise<AttachmentDownload>;
  readonly entries: readonly AttachmentArchiveEntry[];
  readonly firstDownload: AttachmentDownload;
  readonly messageId: MessageId;
  readonly onCancel: (reason: unknown) => void;
  readonly onFinalize: () => void;
  readonly signal: AbortSignal;
}

export interface AttachmentArchiveGeneratorOptions
  extends AttachmentArchiveStreamOptions {
  readonly firstSource: AttachmentArchiveSource;
}

const archiveError = (
  code: "aborted" | "provider_failure" | "size_limit_exceeded" | "timeout",
  message: string,
): AttachmentDownloadError => new AttachmentDownloadError(code, message);

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw attachmentArchiveAbortError(signal);
};

export const assertAttachmentArchiveDownloadSize = (
  size: number | null,
): number | null => {
  if (size === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw archiveError(
      "provider_failure",
      "The provider returned an invalid attachment size.",
    );
  }
  if (size > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES) {
    throw archiveError(
      "size_limit_exceeded",
      "An attachment exceeds the archive entry limit.",
    );
  }
  return size;
};

const addOutputBytes = (current: number, amount: number): number => {
  const next = current + amount;
  if (
    !Number.isSafeInteger(next) ||
    next > MAX_ATTACHMENT_ARCHIVE_OUTPUT_BYTES
  ) {
    throw archiveError(
      "size_limit_exceeded",
      "The generated attachment archive is too large.",
    );
  }
  return next;
};

const awaitDownload = async (
  pending: Promise<AttachmentDownload>,
  signal: AbortSignal,
): Promise<AttachmentDownload> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(attachmentArchiveAbortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (download) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) {
          void download.body
            .cancel(attachmentArchiveAbortError(signal))
            .catch(() => undefined);
          return;
        }
        settled = true;
        resolve(download);
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

export const attachmentArchiveBytes = async function* (
  options: AttachmentArchiveGeneratorOptions,
): AsyncGenerator<Uint8Array> {
  const central: ZipCentralEntry[] = [];
  let outputBytes = 0;
  let totalPayloadBytes = 0;

  for (const [index, entry] of options.entries.entries()) {
    throwIfAborted(options.signal);
    const download =
      index === 0
        ? options.firstDownload
        : await awaitDownload(
            options.downloadAttachment({
              attachmentId: entry.attachment.id,
              maxBytes: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
              messageId: options.messageId,
              signal: options.signal,
            }),
            options.signal,
          );
    const source =
      index === 0
        ? options.firstSource
        : ownAttachmentArchiveSource(download.body);
    let complete = false;
    let crc = 0xffffffff;
    let entryBytes = 0;
    let emptyChunks = 0;
    const localOffset = outputBytes;
    try {
      const expectedBytes = assertAttachmentArchiveDownloadSize(download.size);
      const localHeader = createZipLocalHeader(entry.name);
      outputBytes = addOutputBytes(outputBytes, localHeader.byteLength);
      yield localHeader;
      while (true) {
        throwIfAborted(options.signal);
        const chunk = await readAttachmentArchiveSource(
          source,
          options.signal,
        );
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          throw archiveError(
            "provider_failure",
            "The provider returned invalid attachment bytes.",
          );
        }
        if (chunk.value.byteLength === 0) {
          emptyChunks += 1;
          if (emptyChunks > MAX_EMPTY_CHUNKS_PER_ENTRY) {
            throw archiveError(
              "provider_failure",
              "The provider attachment stream made no progress.",
            );
          }
          continue;
        }
        entryBytes += chunk.value.byteLength;
        totalPayloadBytes += chunk.value.byteLength;
        if (
          entryBytes > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES ||
          totalPayloadBytes > MAX_ATTACHMENT_ARCHIVE_BYTES
        ) {
          throw archiveError(
            "size_limit_exceeded",
            "The attachment archive exceeds its decoded byte limit.",
          );
        }
        if (expectedBytes !== null && entryBytes > expectedBytes) {
          throw archiveError(
            "provider_failure",
            "The provider returned more attachment bytes than declared.",
          );
        }
        crc = updateZipCrc32(crc, chunk.value);
        outputBytes = addOutputBytes(outputBytes, chunk.value.byteLength);
        yield chunk.value;
      }
      if (expectedBytes !== null && entryBytes !== expectedBytes) {
        throw archiveError(
          "provider_failure",
          "The provider returned an incomplete attachment.",
        );
      }
      complete = true;
    } finally {
      if (complete) source.release();
      else {
        source.cancel(
          options.signal.aborted
            ? attachmentArchiveAbortError(options.signal)
            : archiveError(
                "provider_failure",
                "The attachment archive entry did not complete.",
              ),
        );
      }
    }

    const crc32 = finishZipCrc32(crc);
    const descriptor = createZipDataDescriptor(crc32, entryBytes);
    outputBytes = addOutputBytes(outputBytes, descriptor.byteLength);
    yield descriptor;
    central.push({ crc32, localOffset, name: entry.name, size: entryBytes });
  }

  const centralOffset = outputBytes;
  for (const entry of central) {
    const encoded = createZipCentralEntry(entry);
    outputBytes = addOutputBytes(outputBytes, encoded.byteLength);
    yield encoded;
  }
  const end = createZipEnd(
    central.length,
    outputBytes - centralOffset,
    centralOffset,
  );
  addOutputBytes(outputBytes, end.byteLength);
  yield end;
};
