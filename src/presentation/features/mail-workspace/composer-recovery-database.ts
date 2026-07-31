"use client";

import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  EXPIRY_INDEX,
  openRecoveryDatabase,
  type RecoveryEnvelope,
  RECORD_ID_INDEX,
  RECORD_STORE,
  recoveryEnvelope,
  recoveryTombstone,
  SCOPE_INDEX,
  SCOPE_UPDATED_INDEX,
  TOMBSTONE_EXPIRY_INDEX,
  TOMBSTONE_STORE,
} from "@/presentation/features/mail-workspace/composer-recovery-database-upgrade";
import {
  cursorValues,
  deleteCursorValues,
  recoveryRecordTombstoneKey,
  recoveryScopeTombstoneKey,
  requestResult,
  transactionComplete,
  trimRecoveryScope,
} from "@/presentation/features/mail-workspace/composer-recovery-database-operations";

const MAX_DATABASE_BATCH = 64;
export interface ComposerRecoveryDatabaseRecord { readonly journal: unknown; readonly recordId: string }

export interface ComposerRecoveryDatabase {
  readonly discoverScope: (sessionScope: string, limit?: number) =>
    Promise<readonly ComposerRecoveryDatabaseRecord[]>;
  readonly get: (recordId: string) => Promise<unknown | null>;
  readonly purgeExpired: (now: number, limit?: number) => Promise<readonly string[]>;
  readonly purgeScope: (sessionScope: string, now?: number) => Promise<void>;
  readonly put: (journal: ComposerRecoveryJournal, now?: number) =>
    Promise<readonly string[]>;
  readonly remove: (recordId: string, now?: number) => Promise<void>;
  readonly trimScope: (sessionScope: string, now?: number) =>
    Promise<readonly string[]>;
}
const sameJournal = (
  left: ComposerRecoveryJournal,
  right: ComposerRecoveryJournal,
): boolean => JSON.stringify(left) === JSON.stringify(right);
const boundedLimit = (limit: number): number => Math.max(
  0, Math.min(MAX_DATABASE_BATCH, Math.trunc(limit)),
);

const abortConflict = async (
  transaction: IDBTransaction,
  completion: Promise<void>,
  message: string,
): Promise<never> => {
  transaction.abort();
  await completion.catch(() => undefined);
  throw new Error(message);
};

export const createComposerRecoveryDatabase = (
  factory: IDBFactory,
): ComposerRecoveryDatabase => {
  let opened: Promise<IDBDatabase> | null = null;
  const database = () => {
    opened ??= openRecoveryDatabase(factory).catch((error: unknown) => {
      opened = null;
      throw error;
    });
    return opened;
  };
  return {
    async discoverScope(sessionScope, limit = MAX_DATABASE_BATCH) {
      const count = boundedLimit(limit);
      if (count === 0) return [];
      const transaction = (await database()).transaction(RECORD_STORE, "readonly");
      const completion = transactionComplete(transaction);
      const range = IDBKeyRange.bound(
        [sessionScope, 0],
        [sessionScope, Number.MAX_SAFE_INTEGER],
      );
      const request = transaction.objectStore(RECORD_STORE)
        .index(SCOPE_UPDATED_INDEX).openCursor(range, "prev");
      const records = await cursorValues(request, count, (cursor) => {
        const stored = cursor.value as RecoveryEnvelope;
        return { journal: stored.journal, recordId: stored.recordId };
      });
      await completion;
      return records;
    },
    async get(recordId) {
      const transaction = (await database()).transaction(RECORD_STORE, "readonly");
      const completion = transactionComplete(transaction);
      const value = await requestResult<RecoveryEnvelope | undefined>(
        transaction.objectStore(RECORD_STORE).index(RECORD_ID_INDEX).get(recordId),
      );
      await completion;
      return value?.journal ?? null;
    },
    async purgeExpired(now, limit = MAX_DATABASE_BATCH) {
      const count = boundedLimit(limit);
      if (count === 0) return [];
      const transaction = (await database()).transaction(
        [RECORD_STORE, TOMBSTONE_STORE], "readwrite",
      );
      const completion = transactionComplete(transaction);
      const records = transaction.objectStore(RECORD_STORE);
      const tombstones = transaction.objectStore(TOMBSTONE_STORE);
      const expiredIds: string[] = [];
      const expired = records.index(EXPIRY_INDEX).openCursor(IDBKeyRange.upperBound(now));
      const obsolete = tombstones.index(TOMBSTONE_EXPIRY_INDEX)
        .openCursor(IDBKeyRange.upperBound(now));
      await Promise.all([
        deleteCursorValues(expired, count, (cursor) => {
          const stored = cursor.value as RecoveryEnvelope;
          if (typeof stored.recordId === "string") {
            expiredIds.push(stored.recordId);
            tombstones.put(
              recoveryTombstone(now),
              recoveryRecordTombstoneKey(stored.recordId),
            );
          }
          cursor.delete();
        }),
        deleteCursorValues(obsolete, count, (cursor) => cursor.delete()),
      ]);
      await completion;
      return expiredIds;
    },
    async purgeScope(sessionScope, now = Date.now()) {
      const transaction = (await database()).transaction(
        [RECORD_STORE, TOMBSTONE_STORE], "readwrite",
      );
      const completion = transactionComplete(transaction);
      const records = transaction.objectStore(RECORD_STORE);
      transaction.objectStore(TOMBSTONE_STORE).put(
        recoveryTombstone(now), recoveryScopeTombstoneKey(sessionScope),
      );
      const request = records.index(SCOPE_INDEX)
        .openKeyCursor(IDBKeyRange.only(sessionScope));
      await new Promise<void>((resolve, reject) => {
        request.addEventListener("error", () => reject(request.error), { once: true });
        request.addEventListener("success", () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          records.delete(cursor.primaryKey);
          cursor.continue();
        });
      });
      await completion;
    },
    async put(journal, now = Date.now()) {
      const next = recoveryEnvelope(journal);
      if (!Number.isFinite(next.expiresAt) || next.expiresAt <= now) {
        throw new Error("Recovery record has expired.");
      }
      const transaction = (await database()).transaction(
        [RECORD_STORE, TOMBSTONE_STORE], "readwrite",
      );
      const completion = transactionComplete(transaction);
      const records = transaction.objectStore(RECORD_STORE);
      const tombstones = transaction.objectStore(TOMBSTONE_STORE);
      const [scopeRevoked, recordRevoked, current] = await Promise.all([
        requestResult(tombstones.get(recoveryScopeTombstoneKey(next.sessionScope))),
        requestResult(tombstones.get(recoveryRecordTombstoneKey(next.recordId))),
        requestResult<RecoveryEnvelope | undefined>(records.get(next.composeKey)),
      ]);
      if (scopeRevoked || recordRevoked) {
        return abortConflict(transaction, completion, "Recovery record is revoked.");
      }
      if (current) {
        const divergent = next.storageRevision === current.storageRevision &&
          !sameJournal(next.journal, current.journal);
        const invalidRevision = next.storageRevision !== current.storageRevision &&
          next.storageRevision !== current.storageRevision + 1;
        if (next.recordId !== current.recordId || divergent || invalidRevision) {
          return abortConflict(transaction, completion, "Recovery write conflict.");
        }
        if (next.storageRevision === current.storageRevision) {
          await completion;
          return [];
        }
      } else if (next.storageRevision !== 1) {
        return abortConflict(transaction, completion, "Recovery write conflict.");
      }
      await requestResult(records.put(next));
      const range = IDBKeyRange.bound(
        [next.sessionScope, 0],
        [next.sessionScope, Number.MAX_SAFE_INTEGER],
      );
      const removed = await trimRecoveryScope({
        now,
        request: records.index(SCOPE_UPDATED_INDEX).openCursor(range, "prev"),
        tombstones,
      });
      await completion;
      return removed;
    },
    async remove(recordId, now = Date.now()) {
      const transaction = (await database()).transaction(
        [RECORD_STORE, TOMBSTONE_STORE], "readwrite",
      );
      const completion = transactionComplete(transaction);
      const records = transaction.objectStore(RECORD_STORE);
      transaction.objectStore(TOMBSTONE_STORE).put(
        recoveryTombstone(now), recoveryRecordTombstoneKey(recordId),
      );
      const key = await requestResult<IDBValidKey | undefined>(
        records.index(RECORD_ID_INDEX).getKey(recordId),
      );
      if (key !== undefined) records.delete(key);
      await completion;
    },
    async trimScope(sessionScope, now = Date.now()) {
      const transaction = (await database()).transaction(
        [RECORD_STORE, TOMBSTONE_STORE], "readwrite",
      );
      const completion = transactionComplete(transaction);
      const records = transaction.objectStore(RECORD_STORE);
      const range = IDBKeyRange.bound(
        [sessionScope, 0],
        [sessionScope, Number.MAX_SAFE_INTEGER],
      );
      const removed = await trimRecoveryScope({
        now,
        request: records.index(SCOPE_UPDATED_INDEX).openCursor(range, "prev"),
        tombstones: transaction.objectStore(TOMBSTONE_STORE),
      });
      await completion;
      return removed;
    },
  };
};

let browserDatabase: ComposerRecoveryDatabase | null | undefined;
export const browserComposerRecoveryDatabase = (): ComposerRecoveryDatabase | null => {
  if (browserDatabase !== undefined) return browserDatabase;
  browserDatabase = typeof indexedDB === "undefined" ? null : createComposerRecoveryDatabase(indexedDB);
  return browserDatabase;
};
