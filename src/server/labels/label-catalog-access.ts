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
  archiveMigratedLabelCatalogFile,
  readLabelCatalogFile,
  writeLabelCatalogFile,
} from "@/server/labels/label-catalog-file";
import {
  emptyLabelCatalog,
  encryptedLabelCatalogSchema,
  type StoredLabelCatalog,
} from "@/server/labels/label-catalog-record";
import { sharedOwnerRepository } from
  "@/server/shared-state/shared-owner-repository";
import { ApiError } from "@/transport/http/api-error";

const globalState = globalThis as typeof globalThis & {
  __vedaMailLabelCatalogQueue?: Promise<void>;
};
globalState.__vedaMailLabelCatalogQueue ??= Promise.resolve();
let migrationPromise: Promise<boolean> | undefined;
const SHARED_RETRY_LIMIT = 5;

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

const ensureMigrated = (): Promise<boolean> => {
  if (!sharedOwnerRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedOwnerRepository.ensureMigrated(
    "label-catalogs",
    async () => {
      const file = await readLabelCatalogFile();
      return Object.fromEntries(Object.entries(file.owners)
        .map(([owner, value]) => [owner, JSON.stringify(value)]));
    },
    archiveMigratedLabelCatalogFile,
  );
  return migrationPromise;
};

const sharedMode = async (): Promise<boolean> => {
  try { return await ensureMigrated(); }
  catch { return unavailable(); }
};

const sharedCatalogValue = async (owner: LabelOwner, sessionSecret: string) => {
  const ownerKey = labelCatalogOwnerKey(owner, sessionSecret);
  const serializedRecord = await sharedOwnerRepository.get(
    "label-catalogs", ownerKey,
  );
  const encrypted = serializedRecord
    ? encryptedLabelCatalogSchema.parse(JSON.parse(serializedRecord))
    : undefined;
  return {
    catalog: encrypted
      ? decryptLabelCatalog(encrypted, ownerKey, sessionSecret)
      : emptyLabelCatalog(),
    ownerKey,
    serializedRecord,
  };
};

export const readLabelCatalog = async (
  owner: LabelOwner,
): Promise<StoredLabelCatalog> => {
  const sessionSecret = await secret();
  try {
    if (await sharedMode()) {
      return (await sharedCatalogValue(owner, sessionSecret)).catalog;
    }
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
  if (await sharedMode()) {
    for (let attempt = 0; attempt < SHARED_RETRY_LIMIT; attempt += 1) {
      let value;
      try { value = await sharedCatalogValue(owner, sessionSecret); }
      catch { return unavailable(); }
      const updated = update(value.catalog);
      let replaced;
      try {
        replaced = await sharedOwnerRepository.compareAndSet(
          "label-catalogs", value.ownerKey, value.serializedRecord,
          JSON.stringify(encryptLabelCatalog(
            updated, value.ownerKey, sessionSecret,
          )),
        );
      } catch { return unavailable(); }
      if (replaced) return updated;
    }
    return unavailable();
  }
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
