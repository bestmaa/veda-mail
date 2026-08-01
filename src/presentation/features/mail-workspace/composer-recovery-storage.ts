"use client";

import type {
  ComposerRecoveryJournal,
  ComposerRecoveryOwner,
  ComposerRecoveryPointer,
} from "@/presentation/features/mail-workspace/composer-recovery.types";
import {
  canonicalComposerRecoveryJournal,
  parseComposerRecoveryJournal,
} from "@/presentation/features/mail-workspace/composer-recovery-schema";
import {
  browserComposerRecoveryDatabase,
  type ComposerRecoveryDatabase,
} from "@/presentation/features/mail-workspace/composer-recovery-database";
import { MAX_RECOVERY_RECORDS_PER_SCOPE } from "@/presentation/features/mail-workspace/composer-recovery-database-operations";
import { z } from "zod";

const POINTER_PREFIX = "veda-mail:composer-recovery:v1:";
const MAX_POINTER_SCAN = 32;
const pointerSchema = z.object({
  recordId: z.string().uuid(),
  sessionScope: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u),
  version: z.literal(1),
}).strict();

export interface ComposerRecoverySessionStorage {
  readonly getItem: (key: string) => string | null;
  readonly key: (index: number) => string | null;
  readonly length: number;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}

export interface ComposerRecoveryStorage {
  readonly list: (
    owner: ComposerRecoveryOwner,
    now?: number,
  ) => Promise<readonly ComposerRecoveryJournal[]>;
  readonly purgeScope: (sessionScope: string) => Promise<void>;
  readonly remove: (recordId: string) => Promise<void>;
  readonly write: (
    journal: ComposerRecoveryJournal,
    now?: number,
  ) => Promise<"stored" | "unavailable">;
}

const pointerKey = (recordId: string): string => `${POINTER_PREFIX}${recordId}`;
const keys = (storage: ComposerRecoverySessionStorage): readonly string[] => {
  const result: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(POINTER_PREFIX)) result.push(key);
    if (result.length >= MAX_POINTER_SCAN) break;
  }
  return result;
};

const parsePointer = (value: string | null): ComposerRecoveryPointer | null => {
  if (!value || value.length > 512) return null;
  try {
    const parsed = pointerSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const ownerMatches = (
  left: ComposerRecoveryOwner,
  right: ComposerRecoveryOwner,
): boolean =>
  left.accountId === right.accountId &&
  left.providerId === right.providerId &&
  left.sessionExpiresAt === right.sessionExpiresAt &&
  left.sessionScope === right.sessionScope;

const isExpired = (journal: ComposerRecoveryJournal, now: number): boolean => {
  const expiresAt = Date.parse(journal.owner.sessionExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
};

const removePointer = (
  storage: ComposerRecoverySessionStorage,
  recordId: string,
): void => {
  try {
    storage.removeItem(pointerKey(recordId));
  } catch {
    // The caller still removes the durable record when browser storage fails.
  }
};

const setPointer = (
  storage: ComposerRecoverySessionStorage,
  journal: ComposerRecoveryJournal,
): boolean => {
  const pointer: ComposerRecoveryPointer = {
    recordId: journal.recordId,
    sessionScope: journal.owner.sessionScope,
    version: 1,
  };
  try {
    storage.setItem(pointerKey(journal.recordId), JSON.stringify(pointer));
    return true;
  } catch {
    return false;
  }
};

export const createComposerRecoveryStorage = ({
  database,
  pointers,
}: {
  readonly database: ComposerRecoveryDatabase;
  readonly pointers: ComposerRecoverySessionStorage;
}): ComposerRecoveryStorage => {
  const remove = async (recordId: string): Promise<void> => {
    removePointer(pointers, recordId);
    await database.remove(recordId);
  };

  const validPointers = (): readonly ComposerRecoveryPointer[] => {
    const result: ComposerRecoveryPointer[] = [];
    for (const key of keys(pointers)) {
      let pointer: ComposerRecoveryPointer | null = null;
      try {
        pointer = parsePointer(pointers.getItem(key));
      } catch {
        // Invalid or inaccessible pointers are removed below.
      }
      if (!pointer || key !== pointerKey(pointer.recordId)) {
        try { pointers.removeItem(key); } catch { /* fail closed */ }
      } else result.push(pointer);
    }
    return result;
  };

  return {
    async list(owner, now = Date.now()) {
      const currentPointers = validPointers();
      let expiredIds: readonly string[];
      let trimmedIds: readonly string[];
      let discovered: Awaited<ReturnType<typeof database.discoverScope>>;
      try {
        expiredIds = await database.purgeExpired(now, MAX_POINTER_SCAN);
        trimmedIds = await database.trimScope(owner.sessionScope, now);
        discovered = await database.discoverScope(
          owner.sessionScope,
          MAX_POINTER_SCAN,
        );
      } catch {
        throw new Error("Composer recovery storage is unavailable.");
      }
      for (const recordId of [...expiredIds, ...trimmedIds]) {
        removePointer(pointers, recordId);
      }
      const candidates = new Map<string, unknown>();
      for (const record of discovered) candidates.set(record.recordId, record.journal);
      for (const pointer of currentPointers) {
        if (pointer.sessionScope !== owner.sessionScope) {
          await remove(pointer.recordId);
          continue;
        }
        let value: unknown;
        try {
          value = await database.get(pointer.recordId);
        } catch {
          throw new Error("Composer recovery storage is unavailable.");
        }
        candidates.set(pointer.recordId, value);
      }
      const journals: ComposerRecoveryJournal[] = [];
      for (const [recordId, value] of candidates) {
        const journal = parseComposerRecoveryJournal(value);
        if (
          !journal ||
          journal.recordId !== recordId ||
          !ownerMatches(journal.owner, owner) ||
          isExpired(journal, now)
        ) {
          await remove(recordId);
          continue;
        }
        journals.push(journal);
      }
      journals.sort((left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      const retained = journals.slice(0, MAX_RECOVERY_RECORDS_PER_SCOPE);
      for (const journal of journals.slice(MAX_RECOVERY_RECORDS_PER_SCOPE)) {
        await remove(journal.recordId);
      }
      for (const journal of retained) setPointer(pointers, journal);
      return retained;
    },
    async purgeScope(sessionScope) {
      for (const pointer of validPointers()) {
        if (pointer.sessionScope === sessionScope) {
          removePointer(pointers, pointer.recordId);
        }
      }
      await database.purgeScope(sessionScope);
    },
    remove,
    async write(journal, now = Date.now()) {
      let canonical: ComposerRecoveryJournal;
      try {
        canonical = canonicalComposerRecoveryJournal(journal);
        if (isExpired(canonical, now)) return "unavailable";
        if (!setPointer(pointers, canonical)) return "unavailable";
      } catch {
        return "unavailable";
      }
      try {
        const trimmedIds = await database.put(canonical, now);
        for (const recordId of trimmedIds) removePointer(pointers, recordId);
        return trimmedIds.includes(canonical.recordId) ? "unavailable" : "stored";
      } catch {
        return "unavailable";
      }
    },
  };
};

let browserStorage: ComposerRecoveryStorage | null | undefined;

export const browserComposerRecoveryStorage = (): ComposerRecoveryStorage | null => {
  if (browserStorage !== undefined) return browserStorage;
  const database = browserComposerRecoveryDatabase();
  if (!database || typeof window === "undefined") return browserStorage = null;
  try {
    browserStorage = createComposerRecoveryStorage({
      database,
      pointers: window.sessionStorage,
    });
  } catch {
    browserStorage = null;
  }
  return browserStorage;
};
