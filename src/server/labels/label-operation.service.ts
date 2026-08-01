import "server-only";

import type { MailApplicationService } from "@/application/services/mail-application.service";
import type { LabelCleanupResult, LabelOwner } from "@/domain/mail/label";
import {
  LABEL_CLEANUP_MAX_BATCH,
  LabelCleanupCursorError,
} from "@/domain/mail/label";
import type {
  BulkMessageMutation,
  BulkMessageMutationResult,
  MessageMutation,
} from "@/domain/mail/mail";
import { labelCatalogStore } from "@/server/labels/label-catalog.store";
import {
  labelDeletionCatalogStore,
} from "@/server/labels/label-deletion-catalog.store";
import type { LabelDeletionUpdate } from "@/server/labels/label-deletion-progress";
import { withLabelOperation } from "@/server/labels/label-operation-lock";
import { ApiError } from "@/transport/http/api-error";

type LabelMutation = Extract<MessageMutation, { readonly type: "set-label" }>;
type BulkLabelMutation = Extract<
  BulkMessageMutation,
  { readonly type: "set-label" }
>;

export const mutateMessageLabel = (
  service: MailApplicationService,
  owner: LabelOwner,
  mutation: LabelMutation,
): Promise<void> => withLabelOperation(owner, mutation.labelId, async () => {
  await labelCatalogStore.requireActive(owner, mutation.labelId);
  await service.mutateMessage(mutation);
});

export const mutateBulkMessageLabels = (
  service: MailApplicationService,
  owner: LabelOwner,
  request: BulkLabelMutation,
): Promise<BulkMessageMutationResult> => withLabelOperation(
  owner,
  request.labelId,
  async () => {
    await labelCatalogStore.requireActive(owner, request.labelId);
    const outcomes: ("failed" | "succeeded" | "unconfirmed")[] = Array.from(
      { length: request.messageIds.length },
      () => "unconfirmed",
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < request.messageIds.length) {
        const index = cursor++;
        const messageId = request.messageIds[index];
        if (!messageId) continue;
        try {
          await service.mutateMessage({
            labelId: request.labelId,
            messageId,
            type: "set-label",
            value: request.value,
          });
          outcomes[index] = "succeeded";
        } catch (error) {
          outcomes[index] = error instanceof ApiError &&
            error.status >= 400 && error.status < 500
            ? "failed"
            : "unconfirmed";
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, request.messageIds.length) }, worker),
    );
    const idsFor = (outcome: (typeof outcomes)[number]) =>
      request.messageIds.filter((_, index) => outcomes[index] === outcome);
    const unconfirmed = idsFor("unconfirmed");
    return {
      // Preserve the conservative legacy contract while exposing ambiguity to
      // clients that can reconcile it safely.
      failed: request.messageIds.filter(
        (_, index) => outcomes[index] !== "succeeded",
      ),
      succeeded: idsFor("succeeded"),
      ...(unconfirmed.length ? { unconfirmed } : {}),
    };
  },
);

const cleanup = (
  service: MailApplicationService,
  labelId: LabelMutation["labelId"],
  cursor: string | null,
): Promise<LabelCleanupResult> => service.cleanupLabel({
  ...(cursor ? { cursor } : {}),
  labelId,
  limit: LABEL_CLEANUP_MAX_BATCH,
});

const runDeletionBatch = async (
  service: MailApplicationService,
  owner: LabelOwner,
  labelId: LabelMutation["labelId"],
  attempt: number,
): Promise<LabelDeletionUpdate> => {
  const claim = await labelDeletionCatalogStore.claim(owner, labelId);
  try {
    const result = await cleanup(service, labelId, claim.cursor);
    return await labelDeletionCatalogStore.record(owner, claim, result);
  } catch (error) {
    if (
      attempt === 0 && claim.cursor &&
      error instanceof LabelCleanupCursorError
    ) {
      await labelDeletionCatalogStore.restart(owner, claim);
      return runDeletionBatch(service, owner, labelId, 1);
    }
    await labelDeletionCatalogStore.release(owner, claim)
      .catch(() => undefined);
    throw error;
  }
};

export const deleteLabelBatch = (
  service: MailApplicationService,
  owner: LabelOwner,
  labelId: LabelMutation["labelId"],
): Promise<LabelDeletionUpdate> => withLabelOperation(
  owner,
  labelId,
  () => runDeletionBatch(service, owner, labelId, 0),
);
