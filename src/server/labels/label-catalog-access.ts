import "server-only";

import type { MailLabel, LabelOwner } from "@/domain/mail/label";
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
    () => undefined,
    () => undefined,
  );
  return result;
};

const unavailable = (): never => {
  throw new ApiError(
    "Labels are temporarily unavailable.",
    "LABELS_UNAVAILABLE",
    500,
  );
};

const secret = async (): Promise<string> => {
  try {
    const installation = await installationStore.get();
    return installation?.sessionSecret ?? unavailable();
  } catch {
    return unavailable();
  }
};

export const readLabelCatalog = async (
  owner: LabelOwner,
): Promise<StoredLabelCatalog> => {
  const sessionSecret = await secret();
  try {
    const file = await readLabelCatalogFile();
    const ownerKey = labelCatalogOwnerKey(owner, sessionSecret);
    const encrypted = file.owners[ownerKey];
    return encrypted
      ? decryptLabelCatalog(encrypted, ownerKey, sessionSecret)
      : emptyLabelCatalog();
  } catch {
    return unavailable();
  }
};

const labelCatalogValue = async (owner: LabelOwner, sessionSecret: string) => {
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

export const labelsOf = (
  catalog: StoredLabelCatalog,
  status?: "active" | "deleting",
): readonly MailLabel[] => Object.entries(catalog.labels)
  .filter(([, label]) => status === undefined || label.status === status)
  .map(([labelId, label]) => ({
    color: label.color,
    id: labelId as LabelId,
    name: label.name,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

export const writeLabelCatalog = async (
  owner: LabelOwner,
  update: (catalog: StoredLabelCatalog) => StoredLabelCatalog,
): Promise<StoredLabelCatalog> => serialized(async () => {
  const sessionSecret = await secret();
  const value = await labelCatalogValue(owner, sessionSecret);
  const updated = update(value.catalog);
  try {
    await writeLabelCatalogFile({
      ...value.file,
      owners: {
        ...value.file.owners,
        [value.ownerKey]: encryptLabelCatalog(
          updated,
          value.ownerKey,
          sessionSecret,
        ),
      },
      updatedAt: updated.updatedAt,
    });
    return updated;
  } catch {
    return unavailable();
  }
});
