"use client";

import {
  recoveryTombstone,
  type RecoveryEnvelope,
} from "@/presentation/features/mail-workspace/composer-recovery-database-upgrade";

export const MAX_RECOVERY_RECORDS_PER_SCOPE = 4;

export const recoveryRecordTombstoneKey = (recordId: string): string =>
  `record:${recordId}`;
export const recoveryScopeTombstoneKey = (sessionScope: string): string =>
  `scope:${sessionScope}`;

export const requestResult = <T,>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(
      request.error ?? new Error("Recovery database request failed."),
    ), { once: true });
  });

export const transactionComplete = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(
      transaction.error ?? new Error("Recovery database transaction aborted."),
    ), { once: true });
    transaction.addEventListener("error", () => reject(
      transaction.error ?? new Error("Recovery database transaction failed."),
    ), { once: true });
  });

export const cursorValues = <T,>(
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
  value: (cursor: IDBCursorWithValue) => T,
): Promise<readonly T[]> => new Promise((resolve, reject) => {
  const result: T[] = [];
  request.addEventListener("error", () => reject(request.error), { once: true });
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor || result.length >= limit) return resolve(result);
    result.push(value(cursor));
    cursor.continue();
  });
});

export const deleteCursorValues = (
  request: IDBRequest<IDBCursorWithValue | null>,
  limit: number,
  remove: (cursor: IDBCursorWithValue) => void,
): Promise<void> => new Promise((resolve, reject) => {
  let removed = 0;
  request.addEventListener("error", () => reject(request.error), { once: true });
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor || removed >= limit) return resolve();
    remove(cursor);
    removed += 1;
    cursor.continue();
  });
});

export const trimRecoveryScope = ({
  now,
  request,
  tombstones,
}: {
  readonly now: number;
  readonly request: IDBRequest<IDBCursorWithValue | null>;
  readonly tombstones: IDBObjectStore;
}): Promise<readonly string[]> => new Promise((resolve, reject) => {
  const removed: string[] = [];
  let retained = 0;
  request.addEventListener("error", () => reject(request.error), { once: true });
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return resolve(removed);
    if (retained < MAX_RECOVERY_RECORDS_PER_SCOPE) {
      retained += 1;
    } else {
      const stored = cursor.value as RecoveryEnvelope;
      if (typeof stored.recordId === "string") {
        removed.push(stored.recordId);
        tombstones.put(
          recoveryTombstone(now),
          recoveryRecordTombstoneKey(stored.recordId),
        );
      }
      cursor.delete();
    }
    cursor.continue();
  });
});
