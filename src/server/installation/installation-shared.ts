import "server-only";

import type { InstallationRecord } from
  "@/domain/installation/installation";
import {
  archiveMigratedInstallation,
  readInstallation,
} from "@/server/installation/installation-file";
import { installationRecordSchema } from
  "@/server/installation/installation.schema";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";

const KIND = "installation" as const;
let migrationPromise: Promise<boolean> | undefined;

export interface SharedInstallationSnapshot {
  installation: InstallationRecord | null;
  serialized: string | null;
}

export const ensureInstallationMigrated = (): Promise<boolean> => {
  if (!sharedRecordRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedRecordRepository.ensureMigrated(
    KIND,
    async () => {
      const installation = await readInstallation();
      return installation ? encryptSharedRecord(KIND, installation) : null;
    },
    archiveMigratedInstallation,
  );
  return migrationPromise;
};

export const sharedInstallation = async (): Promise<SharedInstallationSnapshot> => {
  const serialized = await sharedRecordRepository.get(KIND);
  return {
    installation: serialized
      ? decryptSharedRecord(KIND, serialized, installationRecordSchema)
      : null,
    serialized,
  };
};

export const replaceSharedInstallation = (
  current: SharedInstallationSnapshot,
  installation: InstallationRecord,
): Promise<boolean> => sharedRecordRepository.compareAndSet(
  KIND,
  current.serialized,
  encryptSharedRecord(KIND, installation),
);

export const resetInstallationMigrationForTests = (): void => {
  migrationPromise = undefined;
};
