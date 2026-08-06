import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type { ProviderConnection } from "@/domain/provider/provider";
import type {
  AttachmentId,
  DraftId,
  MessageId,
} from "@/domain/shared/brand";
import { defaultAttachmentQuotas, type AttachmentSnapshot } from "@/server/attachments";
import {
  importReceivedAttachment,
  mapAttachmentImportFailure,
} from "@/server/mail/attachment-import";
import {
  createAttachmentImportDeadline,
  waitForAttachmentImport,
} from "@/server/mail/attachment-import-operation";
import {
  assertAttachmentCapability,
  attachmentScope,
  attachmentService,
} from "@/server/mail/attachment-service";
import { getMailService } from "@/server/mail/mail-service";
import {
  assertAttachmentFilePolicy,
  getMailContentPolicy,
} from "@/server/organization/mail-content-policy.service";

export interface OriginalAttachmentImportInput {
  readonly attachmentId: AttachmentId;
  readonly connection: ProviderConnection;
  readonly draftId: DraftId;
  readonly messageId: MessageId;
  readonly signal?: AbortSignal;
}

export const importOriginalAttachment = async (
  input: OriginalAttachmentImportInput,
): Promise<AttachmentSnapshot> => {
  const deadline = createAttachmentImportDeadline(input.signal);
  try {
    const providerMaximum = await waitForAttachmentImport(
      assertAttachmentCapability(input.connection, 1),
      deadline.signal,
    );
    const mail = await waitForAttachmentImport(
      getMailService(input.connection),
      deadline.signal,
    );
    const originals = await waitForAttachmentImport(
      mail.listMessageAttachments({
        messageId: input.messageId,
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    const authorized = originals.some(
      (attachment) =>
        attachment.disposition === "attachment" &&
        attachment.id === input.attachmentId,
    );
    if (!authorized) {
      throw new AttachmentDownloadError(
        "not_found",
        "The attachment was not found.",
      );
    }
    const imported = await importReceivedAttachment(
      {
        attachmentId: input.attachmentId,
        messageId: input.messageId,
        scope: attachmentScope(input.connection, input.draftId),
        signal: deadline.signal,
        subject: input.connection.id,
      },
      {
        download: (downloadInput) => mail.downloadAttachment(downloadInput),
        maximumBytes: Math.min(
          providerMaximum,
          defaultAttachmentQuotas.maxFileBytes,
        ),
        quarantine: attachmentService(),
      },
    );
    try {
      assertAttachmentFilePolicy(await getMailContentPolicy(), {
        ...(imported.detectedMimeType
          ? { mimeType: imported.detectedMimeType }
          : {}),
        name: imported.fileName,
        size: imported.contentLength,
      });
    } catch (error) {
      await attachmentService().remove(
        imported.id,
        attachmentScope(input.connection, input.draftId),
      );
      throw error;
    }
    return imported;
  } catch (error) {
    throw mapAttachmentImportFailure(
      error,
      deadline.timedOut(),
      input.signal?.aborted === true,
    );
  } finally {
    deadline.dispose();
  }
};
