import "server-only";

import { randomBytes } from "node:crypto";

import {
  LABEL_CLEANUP_MAX_CURSOR_CHARACTERS,
  type LabelCleanupResult,
  type MailLabelDeletion,
  type LabelOwner,
} from "@/domain/mail/label";
import { requireLabel } from "@/domain/mail/label-policy";
import type { LabelId } from "@/domain/shared/brand";
import {
  labelsOf,
  readLabelCatalog,
  writeLabelCatalog,
} from "@/server/labels/label-catalog-access";
import type { StoredLabelCatalog } from "@/server/labels/label-catalog-record";
import {
  deletionProgress,
  type LabelDeletionClaim,
  type LabelDeletionUpdate,
} from "@/server/labels/label-deletion-progress";
import { ApiError } from "@/transport/http/api-error";

const assertProgress = (result: LabelCleanupResult): void => {
  const cursorValid = result.complete
    ? result.cursor === null
    : typeof result.cursor === "string" &&
      result.cursor.length >= 1 &&
      result.cursor.length <= LABEL_CLEANUP_MAX_CURSOR_CHARACTERS &&
      /^[A-Za-z0-9_-]+$/u.test(result.cursor);
  if (
    !Number.isSafeInteger(result.processed) || result.processed < 0 ||
    !Number.isSafeInteger(result.removed) || result.removed < 0 ||
    result.removed > result.processed || !cursorValid
  ) {
    throw new ApiError(
      "The provider returned invalid label cleanup progress.",
      "LABEL_DELETION_INVALID_PROGRESS",
      502,
    );
  }
};

const retainTombstone = (
  catalog: StoredLabelCatalog,
  labelId: LabelId,
  timestamp: string,
): StoredLabelCatalog["tombstones"] => Object.fromEntries(
  Object.entries({ ...catalog.tombstones, [labelId]: timestamp })
    .sort((left, right) => right[1].localeCompare(left[1]))
    .slice(0, 512),
);

export const labelDeletionCatalogStore = {
  async list(owner: LabelOwner): Promise<readonly MailLabelDeletion[]> {
    const catalog = await readLabelCatalog(owner);
    return Object.entries(catalog.labels).flatMap(([labelId, label]) =>
      label.status === "deleting" && label.deletion
        ? [deletionProgress(labelId as LabelId, label.deletion)]
        : [],
    );
  },

  async claim(
    owner: LabelOwner,
    labelId: LabelId,
  ): Promise<LabelDeletionClaim> {
    const leaseId = randomBytes(32).toString("base64url");
    const updated = await writeLabelCatalog(owner, (catalog) => {
      requireLabel(labelsOf(catalog), labelId);
      const record = catalog.labels[labelId]!;
      const now = new Date();
      const lease = record.deletion?.lease;
      if (lease && Date.parse(lease.expiresAt) > now.getTime()) {
        throw new ApiError(
          "Label deletion is already running.",
          "LABEL_DELETION_BUSY",
          409,
        );
      }
      const timestamp = now.toISOString();
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [labelId]: {
            ...record,
            deletion: {
              cursor: record.deletion?.cursor ?? null,
              emptyChecks: record.deletion?.emptyChecks ?? 0,
              lease: {
                expiresAt: new Date(now.getTime() + 60_000).toISOString(),
                id: leaseId,
              },
              processed: record.deletion?.processed ?? 0,
              removed: record.deletion?.removed ?? 0,
              startedAt: record.deletion?.startedAt ?? timestamp,
              updatedAt: timestamp,
            },
            revision: record.revision + 1,
            status: "deleting",
            updatedAt: timestamp,
          },
        },
        updatedAt: timestamp,
      };
    });
    return {
      cursor: updated.labels[labelId]!.deletion!.cursor,
      labelId,
      leaseId,
    };
  },

  async record(
    owner: LabelOwner,
    claim: LabelDeletionClaim,
    result: LabelCleanupResult,
  ): Promise<LabelDeletionUpdate> {
    assertProgress(result);
    let completed: MailLabelDeletion | null = null;
    let done = false;
    const updated = await writeLabelCatalog(owner, (catalog) => {
      const record = catalog.labels[claim.labelId];
      const deletion = record?.deletion;
      if (
        !record || record.status !== "deleting" ||
        deletion?.lease?.id !== claim.leaseId
      ) {
        throw new ApiError(
          "Label deletion progress is stale.",
          "LABEL_DELETION_STALE",
          409,
        );
      }
      if (
        deletion.processed > Number.MAX_SAFE_INTEGER - result.processed ||
        deletion.removed > Number.MAX_SAFE_INTEGER - result.removed
      ) {
        throw new ApiError(
          "Label deletion progress exceeded its safe bound.",
          "LABEL_DELETION_INVALID_PROGRESS",
          502,
        );
      }
      const now = new Date().toISOString();
      const emptyChecks = result.removed > 0
        ? 0
        : result.complete
          ? Math.min(2, deletion.emptyChecks + 1)
          : deletion.emptyChecks;
      const nextDeletion = {
        ...deletion,
        cursor: result.complete ? null : result.cursor,
        emptyChecks,
        lease: null,
        processed: deletion.processed + result.processed,
        removed: deletion.removed + result.removed,
        updatedAt: now,
      };
      completed = deletionProgress(claim.labelId, nextDeletion);
      if (emptyChecks >= 2) {
        done = true;
        const labels = Object.fromEntries(
          Object.entries(catalog.labels)
            .filter(([candidate]) => candidate !== claim.labelId),
        );
        return {
          ...catalog,
          labels,
          tombstones: retainTombstone(catalog, claim.labelId, now),
          updatedAt: now,
        };
      }
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [claim.labelId]: {
            ...record,
            deletion: nextDeletion,
            revision: record.revision + 1,
            updatedAt: now,
          },
        },
        updatedAt: now,
      };
    });
    return { deletion: completed!, done, labels: labelsOf(updated) };
  },

  async release(owner: LabelOwner, claim: LabelDeletionClaim): Promise<void> {
    await writeLabelCatalog(owner, (catalog) => {
      const record = catalog.labels[claim.labelId];
      if (record?.deletion?.lease?.id !== claim.leaseId) return catalog;
      const now = new Date().toISOString();
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [claim.labelId]: {
            ...record,
            deletion: { ...record.deletion, lease: null, updatedAt: now },
            revision: record.revision + 1,
            updatedAt: now,
          },
        },
        updatedAt: now,
      };
    });
  },

  async restart(owner: LabelOwner, claim: LabelDeletionClaim): Promise<void> {
    await writeLabelCatalog(owner, (catalog) => {
      const record = catalog.labels[claim.labelId];
      if (record?.deletion?.lease?.id !== claim.leaseId) {
        throw new ApiError(
          "Label deletion progress is stale.",
          "LABEL_DELETION_STALE",
          409,
        );
      }
      const now = new Date().toISOString();
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [claim.labelId]: {
            ...record,
            deletion: {
              ...record.deletion,
              cursor: null,
              emptyChecks: 0,
              lease: null,
              updatedAt: now,
            },
            revision: record.revision + 1,
            updatedAt: now,
          },
        },
        updatedAt: now,
      };
    });
  },
};
