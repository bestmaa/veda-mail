import "server-only";

import type { MailLabel, MailLabelDeletion } from "@/domain/mail/label";
import type { LabelId } from "@/domain/shared/brand";
import type { StoredLabelCatalog } from "@/server/labels/label-catalog-record";

export interface LabelDeletionClaim {
  readonly cursor: string | null;
  readonly labelId: LabelId;
  readonly leaseId: string;
}

export interface LabelDeletionUpdate {
  readonly deletion: MailLabelDeletion;
  readonly done: boolean;
  readonly labels: readonly MailLabel[];
}

export const deletionProgress = (
  labelId: LabelId,
  deletion: NonNullable<StoredLabelCatalog["labels"][string]["deletion"]>,
): MailLabelDeletion => ({
  labelId,
  processed: deletion.processed,
  removed: deletion.removed,
  startedAt: deletion.startedAt,
  updatedAt: deletion.updatedAt,
});
