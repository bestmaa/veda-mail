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
import { installationStore } from "@/server/installation/installation.store";
import {
  decryptLabelCatalog,
  encryptLabelCatalog,
  labelCatalogOwnerKey,
} from "@/server/labels/label-catalog-crypto";
import {
  readLabelCatalogFile,
  writeLabelCatalogFile,
} from "@/server/labels/label-catalog-file";
import {
  emptyLabelCatalog,
  type StoredLabelCatalog,
} from "@/server/labels/label-catalog-record";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailLabelCatalogQueue?: Promise<void>;
};
globalState.__vedaMailLabelCatalogQueue ??= Promise.resolve();

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = globalState.__vedaMailLabelCatalogQueue!.then(task, task);
  globalState.__vedaMailLabelCatalogQueue = result.then(
    () => undefined, () => undefined,
  );
  return result;
};
const unavailable = (): never => {
  throw new ApiError("Labels are temporarily unavailable.", "LABELS_UNAVAILABLE", 500);
};
const secret = async (): Promise<string> => {
  try {
    const installation = await installationStore.get();
    return installation?.sessionSecret ?? unavailable();
  } catch {
    return unavailable();
  }
};
const current = async (owner: LabelOwner, sessionSecret: string) => {
  try {
    const file = await readLabelCatalogFile();
    const ownerKey = labelCatalogOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return {
      catalog: encrypted
        ? decryptLabelCatalog(encrypted, ownerKey, sessionSecret)
        : emptyLabelCatalog(),
      file,
      ownerKey,
    };
  } catch {
    return unavailable();
  }
};
const visible = (catalog: StoredLabelCatalog): readonly MailLabel[] =>
  Object.entries(catalog.labels)
    .filter(([, label]) => label.status === "active")
    .map(([labelId, label]) => ({
      color: label.color,
      id: labelId as LabelId,
      name: label.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
const write = async (
  owner: LabelOwner,
  update: (catalog: StoredLabelCatalog) => StoredLabelCatalog,
): Promise<StoredLabelCatalog> => serialized(async () => {
  const sessionSecret = await secret();
  const value = await current(owner, sessionSecret);
  const updated = update(value.catalog);
  try {
    await writeLabelCatalogFile({
      ...value.file,
      owners: {
        ...value.file.owners,
        [value.ownerKey]: encryptLabelCatalog(updated, value.ownerKey, sessionSecret),
      },
      updatedAt: updated.updatedAt,
    });
    return updated;
  } catch {
    return unavailable();
  }
});
const listLabels = async (owner: LabelOwner): Promise<readonly MailLabel[]> => {
  const sessionSecret = await secret();
  return visible((await current(owner, sessionSecret)).catalog);
};

export const labelCatalogStore = {
  list: listLabels,

  async requireActive(owner: LabelOwner, labelId: LabelId): Promise<MailLabel> {
    const labels = await listLabels(owner);
    return requireLabel(labels, labelId);
  },

  async create(
    owner: LabelOwner,
    input: { readonly color: LabelColor; readonly name: string },
  ): Promise<readonly MailLabel[]> {
    const updated = await write(owner, (catalog) => {
      const labels = visible(catalog);
      assertLabelCapacity(labels);
      const name = assertUniqueLabelName(labels, input.name);
      const labelId = createLabelId(randomBytes(16).toString("hex"));
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
    return visible(updated);
  },

  async update(
    owner: LabelOwner,
    labelId: LabelId,
    input: { readonly color?: LabelColor; readonly name?: string },
  ): Promise<readonly MailLabel[]> {
    const updated = await write(owner, (catalog) => {
      const labels = visible(catalog);
      const existing = requireLabel(labels, labelId);
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
    return visible(updated);
  },
};
