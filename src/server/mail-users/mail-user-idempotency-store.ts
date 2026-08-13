import "server-only";

import type { AdminMailUserCreateResult } from "@/domain/admin/mail-user";
import {
  readMailUserIdempotencyLedger,
  writeMailUserIdempotencyLedger,
} from "@/server/mail-users/mail-user-idempotency-file";
import {
  MAX_MAIL_USER_IDEMPOTENCY_ENTRIES,
  MAIL_USER_IDEMPOTENCY_TTL_MS,
} from "@/server/mail-users/mail-user-idempotency-policy";
import {
  ensureMailUserIdempotencyMigrated,
  resetMailUserIdempotencyMigrationForTests,
} from "@/server/mail-users/mail-user-idempotency-shared";
import {
  beginSharedMailUserIdempotency,
  completeSharedMailUserIdempotency,
  failSharedMailUserIdempotency,
} from "@/server/mail-users/mail-user-idempotency-shared-store";
import type {
  LiveMailUserProvision,
  MailUserIdempotencyBegin,
  MailUserIdempotencyLedger,
} from "@/server/mail-users/mail-user-idempotency.types";

export { MAIL_USER_IDEMPOTENCY_TTL_MS } from
  "@/server/mail-users/mail-user-idempotency-policy";

interface MailUserIdempotencyState {
  readonly live: Map<string, LiveMailUserProvision>;
  queue: Promise<void>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailUserIdempotency?: MailUserIdempotencyState;
};

const state = globalState.__vedaMailUserIdempotency ?? {
  live: new Map<string, LiveMailUserProvision>(),
  queue: Promise.resolve(),
};
globalState.__vedaMailUserIdempotency = state;

const serialized = async <T>(task: () => Promise<T>): Promise<T> => {
  const result = state.queue.then(task, task);
  state.queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const cloneResult = (
  result: AdminMailUserCreateResult,
): AdminMailUserCreateResult => structuredClone(result);

const prune = (
  ledger: MailUserIdempotencyLedger,
  now: number,
): MailUserIdempotencyLedger => ({
  entries: Object.fromEntries(
    Object.entries(ledger.entries).filter(([, entry]) => entry.expiresAt > now),
  ),
  version: 1,
});

const readPrunedLedger = async (
  now: number,
): Promise<MailUserIdempotencyLedger> => {
  const ledger = await readMailUserIdempotencyLedger();
  const pruned = prune(ledger, now);
  if (
    Object.keys(pruned.entries).length !== Object.keys(ledger.entries).length
  ) {
    await writeMailUserIdempotencyLedger(pruned);
  }
  return pruned;
};

export const mailUserIdempotencyStore = {
  begin(key: string, fingerprint: string): Promise<MailUserIdempotencyBegin> {
    return serialized(async () => {
      if (await ensureMailUserIdempotencyMigrated()) {
        return beginSharedMailUserIdempotency(key, fingerprint);
      }
      const now = Date.now();
      const ledger = await readPrunedLedger(now);
      const existing = ledger.entries[key];
      if (existing) {
        if (existing.fingerprint !== fingerprint) return { kind: "conflict" };
        if (existing.state === "completed") {
          return { kind: "replay", result: cloneResult(existing.result) };
        }
        const live = state.live.get(key);
        return live?.fingerprint === fingerprint
          ? { kind: "pending", outcome: live.outcome }
          : { kind: "orphaned" };
      }
      if (Object.keys(ledger.entries).length >= MAX_MAIL_USER_IDEMPOTENCY_ENTRIES) {
        return { kind: "capacity" };
      }
      const deferred = Promise.withResolvers<
        Awaited<LiveMailUserProvision["outcome"]>
      >();
      const token = crypto.randomUUID();
      state.live.set(key, {
        fingerprint,
        outcome: deferred.promise,
        resolve: deferred.resolve,
        token,
      });
      try {
        await writeMailUserIdempotencyLedger({
          entries: {
            ...ledger.entries,
            [key]: {
              createdAt: new Date(now).toISOString(),
              expiresAt: now + MAIL_USER_IDEMPOTENCY_TTL_MS,
              fingerprint,
              state: "pending",
            },
          },
          version: 1,
        });
      } catch (error) {
        state.live.delete(key);
        throw error;
      }
      return { kind: "owner", token };
    });
  },

  complete(
    key: string,
    fingerprint: string,
    token: string,
    result: AdminMailUserCreateResult,
  ): Promise<AdminMailUserCreateResult> {
    return serialized(async () => {
      if (await ensureMailUserIdempotencyMigrated()) {
        return completeSharedMailUserIdempotency(key, fingerprint, token, result);
      }
      const live = state.live.get(key);
      if (
        !live ||
        live.token !== token ||
        live.fingerprint !== fingerprint
      ) {
        return cloneResult(result);
      }
      const now = Date.now();
      const ledger = prune(await readMailUserIdempotencyLedger(), now);
      const existing = ledger.entries[key];
      if (existing?.state !== "pending" || existing.fingerprint !== fingerprint) {
        state.live.delete(key);
        live.resolve({ kind: "completed", result: cloneResult(result) });
        return cloneResult(result);
      }
      await writeMailUserIdempotencyLedger({
        entries: {
          ...ledger.entries,
          [key]: {
            ...existing,
            expiresAt: now + MAIL_USER_IDEMPOTENCY_TTL_MS,
            result: cloneResult(result),
            state: "completed",
          },
        },
        version: 1,
      });
      state.live.delete(key);
      live.resolve({ kind: "completed", result: cloneResult(result) });
      return cloneResult(result);
    });
  },

  fail(
    key: string,
    fingerprint: string,
    token: string,
    error: unknown,
    preserve: boolean,
  ): Promise<void> {
    return serialized(async () => {
      if (await ensureMailUserIdempotencyMigrated()) {
        await failSharedMailUserIdempotency(key, fingerprint, token, preserve);
        return;
      }
      const live = state.live.get(key);
      if (!live || live.token !== token || live.fingerprint !== fingerprint) return;
      try {
        if (!preserve) {
          const ledger = prune(await readMailUserIdempotencyLedger(), Date.now());
          const entries = { ...ledger.entries };
          delete entries[key];
          await writeMailUserIdempotencyLedger({ entries, version: 1 });
        }
      } finally {
        state.live.delete(key);
        live.resolve({ error, kind: "failed" });
      }
    });
  },

  clearMemoryForTests(): void {
    state.live.clear();
    state.queue = Promise.resolve();
    resetMailUserIdempotencyMigrationForTests();
  },
};
