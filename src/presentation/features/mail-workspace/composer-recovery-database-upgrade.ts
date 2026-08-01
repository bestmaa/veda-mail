"use client";

import { MEMBER_CONNECTION_TTL_MS } from "@/domain/provider/connection-lifetime-policy";
import type { ComposerRecoveryJournal } from "@/presentation/features/mail-workspace/composer-recovery.types";

export const RECOVERY_DATABASE_NAME = "veda-mail-composer-recovery-v2";
export const RECOVERY_DATABASE_VERSION = 2;
export const RECORD_STORE = "records";
export const TOMBSTONE_STORE = "tombstones";
export const RECORD_ID_INDEX = "record-id";
export const SCOPE_INDEX = "session-scope";
export const SCOPE_UPDATED_INDEX = "scope-updated";
export const EXPIRY_INDEX = "expires-at";
export const TOMBSTONE_EXPIRY_INDEX = "retain-until";
export const RECOVERY_TOMBSTONE_RETENTION_MS = 14 * MEMBER_CONNECTION_TTL_MS;

export interface RecoveryEnvelope {
  readonly composeKey: [string, string];
  readonly expiresAt: number;
  readonly journal: ComposerRecoveryJournal;
  readonly recordId: string;
  readonly sessionScope: string;
  readonly storageRevision: number;
  readonly updatedAt: number;
}

export interface RecoveryTombstone {
  readonly createdAt: number;
  readonly retainUntil: number;
}

const timestamp = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const recoveryEnvelope = (
  journal: ComposerRecoveryJournal,
): RecoveryEnvelope => ({
  composeKey: [journal.owner.sessionScope, journal.composeId],
  expiresAt: timestamp(journal.owner.sessionExpiresAt),
  journal,
  recordId: journal.recordId,
  sessionScope: journal.owner.sessionScope,
  storageRevision: journal.storageRevision,
  updatedAt: timestamp(journal.updatedAt),
});

export const recoveryTombstone = (createdAt: number): RecoveryTombstone => ({
  createdAt,
  retainUntil: createdAt + RECOVERY_TOMBSTONE_RETENTION_MS,
});

const normalizeEnvelope = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const journal = record["journal"] as Record<string, unknown> | undefined;
  const owner = journal?.["owner"] as Record<string, unknown> | undefined;
  return {
    ...record,
    expiresAt: timestamp(owner?.["sessionExpiresAt"]),
    updatedAt: timestamp(journal?.["updatedAt"]),
  };
};

const normalizeTombstone = (value: unknown): RecoveryTombstone => {
  if (value && typeof value === "object") {
    const stored = value as Record<string, unknown>;
    const createdAt = timestamp(stored["createdAt"], Date.now());
    const retainUntil = timestamp(
      stored["retainUntil"],
      createdAt + RECOVERY_TOMBSTONE_RETENTION_MS,
    );
    return { createdAt, retainUntil };
  }
  return recoveryTombstone(timestamp(value, Date.now()));
};

const ensureIndex = (
  store: IDBObjectStore,
  name: string,
  keyPath: string | readonly string[],
  unique = false,
): void => {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, { unique });
};

const upgradeDatabase = (request: IDBOpenDBRequest): void => {
  const database = request.result;
  const transaction = request.transaction;
  if (!transaction) throw new Error("Recovery database upgrade transaction is missing.");
  const records = database.objectStoreNames.contains(RECORD_STORE)
    ? transaction.objectStore(RECORD_STORE)
    : database.createObjectStore(RECORD_STORE, { keyPath: "composeKey" });
  ensureIndex(records, RECORD_ID_INDEX, "recordId", true);
  ensureIndex(records, SCOPE_INDEX, "sessionScope");
  ensureIndex(records, SCOPE_UPDATED_INDEX, ["sessionScope", "updatedAt"]);
  ensureIndex(records, EXPIRY_INDEX, "expiresAt");
  const tombstones = database.objectStoreNames.contains(TOMBSTONE_STORE)
    ? transaction.objectStore(TOMBSTONE_STORE)
    : database.createObjectStore(TOMBSTONE_STORE);
  ensureIndex(tombstones, TOMBSTONE_EXPIRY_INDEX, "retainUntil");
  const recordCursor = records.openCursor();
  recordCursor.addEventListener("success", () => {
    const cursor = recordCursor.result;
    if (cursor) {
      cursor.update(normalizeEnvelope(cursor.value));
      cursor.continue();
    }
  });
  const tombstoneCursor = tombstones.openCursor();
  tombstoneCursor.addEventListener("success", () => {
    const cursor = tombstoneCursor.result;
    if (cursor) {
      cursor.update(normalizeTombstone(cursor.value));
      cursor.continue();
    }
  });
};

export const openRecoveryDatabase = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    let abandoned = false;
    const request = factory.open(RECOVERY_DATABASE_NAME, RECOVERY_DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => upgradeDatabase(request));
    request.addEventListener("success", () => {
      const database = request.result;
      if (abandoned) {
        database.close();
        return;
      }
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    }, { once: true });
    request.addEventListener("blocked", () => {
      abandoned = true;
      reject(new Error("Recovery database upgrade is blocked."));
    }, { once: true });
    request.addEventListener("error", () => reject(
      request.error ?? new Error("Recovery database could not open."),
    ), { once: true });
  });
