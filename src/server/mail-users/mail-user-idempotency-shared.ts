import "server-only";

import {
  archiveMigratedMailUserIdempotencyFile,
  mailUserIdempotencyLedgerSchema,
  readMailUserIdempotencyLedger,
} from "@/server/mail-users/mail-user-idempotency-file";
import type { MailUserIdempotencyLedger } from
  "@/server/mail-users/mail-user-idempotency.types";
import {
  decryptSharedRecord,
  encryptSharedRecord,
} from "@/server/shared-state/shared-record-crypto";
import { sharedRecordRepository } from
  "@/server/shared-state/shared-record-repository";

const KIND = "mail-user-idempotency" as const;
let migrationPromise: Promise<boolean> | undefined;

const emptyLedger = (): MailUserIdempotencyLedger => ({ entries: {}, version: 1 });

export const ensureMailUserIdempotencyMigrated = (): Promise<boolean> => {
  if (!sharedRecordRepository.configured()) return Promise.resolve(false);
  migrationPromise ??= sharedRecordRepository.ensureMigrated(
    KIND,
    async () => {
      const ledger = await readMailUserIdempotencyLedger();
      return Object.keys(ledger.entries).length > 0
        ? encryptSharedRecord(KIND, ledger)
        : null;
    },
    archiveMigratedMailUserIdempotencyFile,
  );
  return migrationPromise;
};

export const sharedMailUserIdempotencyLedger = async () => {
  const serialized = await sharedRecordRepository.get(KIND);
  return {
    ledger: serialized
      ? decryptSharedRecord(
        KIND, serialized, mailUserIdempotencyLedgerSchema,
      ) as MailUserIdempotencyLedger
      : emptyLedger(),
    serialized,
  };
};

export const replaceSharedMailUserIdempotencyLedger = (
  current: Awaited<ReturnType<typeof sharedMailUserIdempotencyLedger>>,
  ledger: MailUserIdempotencyLedger,
): Promise<boolean> => sharedRecordRepository.compareAndSet(
  KIND,
  current.serialized,
  encryptSharedRecord(KIND, ledger),
);

export const resetMailUserIdempotencyMigrationForTests = (): void => {
  migrationPromise = undefined;
};
