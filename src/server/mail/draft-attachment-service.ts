import "server-only";

import { createHash } from "node:crypto";

import type { OutgoingAttachment } from "@/domain/mail/mail";
import type { DraftDetail, DraftSaveInput } from "@/domain/mail/draft";
import { id, type DraftId } from "@/domain/shared/brand";
import type { ProviderConnection } from "@/domain/provider/provider";
import {
  asAttachmentApiError,
  assertAttachmentCapability,
  attachmentScope,
  attachmentService,
} from "@/server/mail/attachment-service";
import {
  attachmentSendMemoryBudget,
  type AttachmentSendMemoryLease,
} from "@/server/mail/attachment-send-memory-budget";
import { getMailService } from "@/server/mail/mail-service";
import {
  asAttachmentMetadata,
  asSavedAttachmentMetadata,
  assertOutgoingMailPolicy,
  getMailContentPolicy,
} from "@/server/organization/mail-content-policy.service";

export interface PreparedDraftAttachments {
  readonly attachments: readonly OutgoingAttachment[];
  complete(): Promise<void>;
  release(): Promise<void>;
}

const empty = (): PreparedDraftAttachments => ({
  attachments: [],
  async complete() {},
  async release() {},
});

export const prepareDraftAttachments = async (
  connection: ProviderConnection,
  composeId: DraftId,
  uploadIds: readonly string[],
): Promise<PreparedDraftAttachments> => {
  if (uploadIds.length === 0) return empty();
  const quarantine = attachmentService();
  const scope = attachmentScope(connection, composeId);
  let lease: AttachmentSendMemoryLease | undefined;
  let claimed = false;
  try {
    const selected = await Promise.all(
      uploadIds.map((uploadId) => quarantine.inspect(uploadId, scope)),
    );
    await assertAttachmentCapability(
      connection,
      Math.max(...selected.map(({ contentLength }) => contentLength)),
    );
    lease = await attachmentSendMemoryBudget().acquire(
      selected.reduce((total, item) => total + item.contentLength, 0),
    );
    const snapshots = await quarantine.claim(uploadIds, scope);
    claimed = true;
    const attachments = await Promise.all(
      snapshots.map(async (attachment) => {
        const content = await quarantine.readClaimed(attachment.id, scope);
        return {
          content,
          id: id.attachmentUpload(attachment.id),
          mimeType: attachment.detectedMimeType ?? "application/octet-stream",
          name: attachment.fileName,
          sha256: createHash("sha256").update(content).digest("hex"),
          size: attachment.contentLength,
        };
      }),
    );
    let settled = false;
    const settle = async (consume: boolean) => {
      if (settled) return;
      settled = true;
      try {
        if (consume) {
          await quarantine.consume(uploadIds, scope).catch(() => {
            console.error("[veda-mail] Saved draft attachment cleanup failed.");
          });
        } else await quarantine.release(uploadIds, scope);
      } finally {
        lease?.release();
      }
    };
    return {
      attachments,
      complete: () => settle(true),
      release: () => settle(false),
    };
  } catch (error) {
    if (claimed) await quarantine.release(uploadIds, scope).catch(() => undefined);
    lease?.release();
    throw asAttachmentApiError(error);
  }
};

export const withPreparedDraftAttachments = async <T>(
  connection: ProviderConnection,
  composeId: DraftId,
  uploadIds: readonly string[],
  operation: (attachments: readonly OutgoingAttachment[]) => Promise<T>,
): Promise<T> => {
  const prepared = await prepareDraftAttachments(connection, composeId, uploadIds);
  try {
    const result = await operation(prepared.attachments);
    await prepared.complete();
    return result;
  } catch (error) {
    await prepared.release().catch(() => undefined);
    throw error;
  }
};

export const saveDraftWithAttachments = async (
  connection: ProviderConnection,
  input: DraftSaveInput,
  uploadIds: readonly string[],
): Promise<DraftDetail> => withPreparedDraftAttachments(
  connection,
  input.composeId,
  uploadIds,
  async (attachments) => {
    const mail = await getMailService(connection);
    const retained = input.providerDraftId && input.retainedAttachmentIds?.length
      ? (await mail.getDraft(input.providerDraftId)).attachments?.filter(
          ({ id: attachmentId }) =>
            input.retainedAttachmentIds?.includes(attachmentId),
        ) ?? []
      : [];
    assertOutgoingMailPolicy(
      await getMailContentPolicy(),
      input.content,
      [
        ...retained.map(asSavedAttachmentMetadata),
        ...attachments.map(asAttachmentMetadata),
      ],
    );
    return mail.saveDraft({
      ...input,
      attachments,
    } as DraftSaveInput);
  },
);
