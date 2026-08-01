import "server-only";

import { randomBytes } from "node:crypto";

import {
  createLabelId,
  type LabelColor,
  type LabelOwner,
  type MailLabel,
} from "@/domain/mail/label";
import {
  assertLabelCapacity,
  assertUniqueLabelName,
  requireLabel,
} from "@/domain/mail/label-policy";
import type { LabelId } from "@/domain/shared/brand";
import {
  labelsOf,
  readLabelCatalog,
  writeLabelCatalog,
} from "@/server/labels/label-catalog-access";

const listLabels = async (owner: LabelOwner): Promise<readonly MailLabel[]> => {
  return labelsOf(await readLabelCatalog(owner));
};

export const labelCatalogStore = {
  list: listLabels,

  async requireActive(owner: LabelOwner, labelId: LabelId): Promise<MailLabel> {
    return requireLabel(
      labelsOf(await readLabelCatalog(owner), "active"),
      labelId,
    );
  },

  async create(
    owner: LabelOwner,
    input: { readonly color: LabelColor; readonly name: string },
  ): Promise<readonly MailLabel[]> {
    const updated = await writeLabelCatalog(owner, (catalog) => {
      const labels = labelsOf(catalog);
      assertLabelCapacity(labels);
      const name = assertUniqueLabelName(labels, input.name);
      let labelId = createLabelId(randomBytes(16).toString("hex"));
      while (catalog.labels[labelId] || catalog.tombstones[labelId]) {
        labelId = createLabelId(randomBytes(16).toString("hex"));
      }
      const now = new Date().toISOString();
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [labelId]: {
            color: input.color,
            createdAt: now,
            name,
            revision: 1,
            status: "active",
            updatedAt: now,
          },
        },
        updatedAt: now,
      };
    });
    return labelsOf(updated);
  },

  async update(
    owner: LabelOwner,
    labelId: LabelId,
    input: { readonly color?: LabelColor; readonly name?: string },
  ): Promise<readonly MailLabel[]> {
    const updated = await writeLabelCatalog(owner, (catalog) => {
      const labels = labelsOf(catalog);
      const existing = requireLabel(labelsOf(catalog, "active"), labelId);
      const record = catalog.labels[labelId]!;
      const now = new Date().toISOString();
      return {
        ...catalog,
        labels: {
          ...catalog.labels,
          [labelId]: {
            ...record,
            color: input.color ?? existing.color,
            name: input.name === undefined
              ? existing.name
              : assertUniqueLabelName(labels, input.name, labelId),
            revision: record.revision + 1,
            updatedAt: now,
          },
        },
        updatedAt: now,
      };
    });
    return labelsOf(updated);
  },

};
