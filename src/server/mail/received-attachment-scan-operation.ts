import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type { AttachmentDownload } from "@/domain/mail/mail";
import {
  MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
  normalizeReceivedAttachmentMimeType,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";
import type {
  ReceivedAttachmentScanScope,
  ReceivedAttachmentScanSpool,
} from "@/server/mail/received-attachment-scan";

export interface PreparedReceivedAttachment {
  readonly mimeType: string;
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
  dispose(): Promise<void>;
  open(signal?: AbortSignal): Promise<AttachmentDownload>;
}

const expectedSize = (size: number | null): number | null => {
  if (size === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new AttachmentDownloadError(
      "provider_failure",
      "The mail provider returned invalid attachment metadata.",
    );
  }
  if (size > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES) {
    throw new AttachmentDownloadError(
      "size_limit_exceeded",
      "The attachment exceeds the inspection size limit.",
    );
  }
  return size;
};

export const stageReceivedAttachmentDownload = async (
  download: AttachmentDownload,
  scope: ReceivedAttachmentScanScope,
  spool: Pick<ReceivedAttachmentScanSpool, "stage">,
  signal?: AbortSignal,
): Promise<PreparedReceivedAttachment> => {
  let handle: Awaited<ReturnType<typeof spool.stage>> | undefined;
  try {
    handle = await spool.stage({
      body: download.body,
      expectedBytes: expectedSize(download.size),
      scope,
      ...(signal ? { signal } : {}),
    });
    const clean = handle;
    let opened = false;
    return {
      dispose: () => clean.dispose(),
      mimeType: normalizeReceivedAttachmentMimeType(download.mimeType),
      name: sanitizeReceivedAttachmentName(download.name),
      async open(signal) {
        if (opened) {
          throw new AttachmentDownloadError(
            "invalid_request",
            "The inspected attachment is single-use.",
          );
        }
        opened = true;
        return {
          body: await clean.serve(scope, signal),
          mimeType: "application/octet-stream",
          name: sanitizeReceivedAttachmentName(download.name),
          size: clean.snapshot.byteLength,
        };
      },
      sha256: clean.snapshot.sha256,
      size: clean.snapshot.byteLength,
    };
  } catch (error) {
    await handle?.dispose().catch(() => undefined);
    void download.body.cancel(error).catch(() => undefined);
    throw error;
  }
};
