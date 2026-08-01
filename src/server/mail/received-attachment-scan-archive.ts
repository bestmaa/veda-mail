import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentDownload,
  MessageAttachmentMetadata,
} from "@/domain/mail/mail";
import type { AttachmentId, MessageId } from "@/domain/shared/brand";
import { MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES } from "@/domain/mail/received-attachment";
import { MAX_ATTACHMENT_ARCHIVE_BYTES } from "@/server/mail/attachment-archive-generator";
import { waitForAttachmentImport } from "@/server/mail/attachment-import-operation";
import {
  stageReceivedAttachmentDownload,
  type PreparedReceivedAttachment,
} from "@/server/mail/received-attachment-scan-operation";
import type { ReceivedAttachmentScanSpool } from "@/server/mail/received-attachment-scan";

export interface ScannedAttachmentArchiveSources {
  dispose(): Promise<void>;
  open(
    attachmentId: AttachmentId,
    signal?: AbortSignal,
  ): Promise<AttachmentDownload>;
}

interface StageArchiveInput {
  readonly attachments: readonly MessageAttachmentMetadata[];
  readonly connectionId: string;
  readonly mail: MailApplicationService;
  readonly messageId: MessageId;
  readonly signal: AbortSignal;
  readonly spool: Pick<ReceivedAttachmentScanSpool, "stage">;
}

const archiveTooLarge = (): AttachmentDownloadError =>
  new AttachmentDownloadError(
    "size_limit_exceeded",
    "The inspected attachment archive exceeds its byte limit.",
  );

const cancelLateDownload = (download: AttachmentDownload): void => {
  void download.body
    .cancel(
      new AttachmentDownloadError(
        "aborted",
        "The attachment archive was cancelled.",
      ),
    )
    .catch(() => undefined);
};

export const stageAttachmentArchiveSources = async (
  input: StageArchiveInput,
): Promise<ScannedAttachmentArchiveSources> => {
  const prepared = new Map<string, PreparedReceivedAttachment>();
  let actualBytes = 0;
  const dispose = async (): Promise<void> => {
    await Promise.all(
      [...prepared.values()].map((attachment) =>
        attachment.dispose().catch(() => undefined),
      ),
    );
    prepared.clear();
  };
  try {
    for (const attachment of input.attachments) {
      if (input.signal.aborted) {
        throw new AttachmentDownloadError(
          "aborted",
          "The attachment archive was cancelled.",
        );
      }
      const download = await waitForAttachmentImport(
        input.mail.downloadAttachment({
          attachmentId: attachment.id,
          maxBytes: MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
          messageId: input.messageId,
          signal: input.signal,
        }),
        input.signal,
        cancelLateDownload,
      );
      const clean = await stageReceivedAttachmentDownload(
        download,
        {
          attachmentId: attachment.id,
          connectionId: input.connectionId,
          messageId: input.messageId,
        },
        input.spool,
        input.signal,
      );
      actualBytes += clean.size;
      if (
        !Number.isSafeInteger(actualBytes) || actualBytes > MAX_ATTACHMENT_ARCHIVE_BYTES
      ) {
        await clean.dispose();
        throw archiveTooLarge();
      }
      prepared.set(attachment.id, clean);
    }
    return {
      dispose,
      async open(attachmentId, signal) {
        const clean = prepared.get(attachmentId);
        if (!clean) {
          throw new AttachmentDownloadError(
            "not_found",
            "The inspected attachment was not found.",
          );
        }
        prepared.delete(attachmentId);
        try {
          return await clean.open(signal);
        } catch (error) {
          await clean.dispose().catch(() => undefined);
          throw error;
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
};
