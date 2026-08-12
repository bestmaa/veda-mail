import "server-only";
import { z } from "zod";
import {
  decryptSharedSession,
  encryptSharedSession,
  sharedSessionOpaqueId,
} from "@/server/shared-state/shared-session-crypto";
import { sharedSessionRepository } from "@/server/shared-state/shared-session-repository";
import { sharedStateRedisConfigured } from "@/server/shared-state/shared-state-redis";

export const ADMIN_SESSION_IDLE_TTL_SECONDS = 30 * 60;

export interface AdminSessionRecord {
  readonly authVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
}

const adminSessionRecordSchema: z.ZodType<AdminSessionRecord> = z.object({
  authVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  lastSeenAt: z.string().datetime(),
}).strict();

interface AdminSessionState {
  readonly sessions: Map<string, AdminSessionRecord>;
}

const globalState = globalThis as typeof globalThis & {
  __vedaMailAdminSessions?: AdminSessionState;
};

const state = globalState.__vedaMailAdminSessions ?? { sessions: new Map() };
globalState.__vedaMailAdminSessions = state;

const idleExpiresAt = (session: AdminSessionRecord): number =>
  Date.parse(session.lastSeenAt) + ADMIN_SESSION_IDLE_TTL_SECONDS * 1_000;

const expiresAt = (session: AdminSessionRecord): number =>
  Math.min(Date.parse(session.expiresAt), idleExpiresAt(session));

const isExpired = (session: AdminSessionRecord, now: number): boolean =>
  expiresAt(session) <= now;

const prune = (now = Date.now(), authVersion?: number): void => {
  for (const [sessionId, session] of state.sessions) {
    if (
      isExpired(session, now) ||
      (authVersion !== undefined && session.authVersion !== authVersion)
    ) {
      state.sessions.delete(sessionId);
    }
  }
};

const decode = (opaqueId: string, serialized: string): AdminSessionRecord =>
  decryptSharedSession("administrator", opaqueId, serialized, adminSessionRecordSchema);

const removeShared = async (id: string): Promise<boolean> => {
  const removed = await sharedSessionRepository.remove({
    kind: "administrator",
    opaqueId: sharedSessionOpaqueId("administrator", id),
  });
  return removed ?? false;
};

const getShared = async (
  sessionId: string,
  authVersion: number,
  touch: boolean,
): Promise<AdminSessionRecord | null> => {
  const opaqueId = sharedSessionOpaqueId("administrator", sessionId);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stored = await sharedSessionRepository.get("administrator", opaqueId);
    if (!stored) return null;
    const session = decode(opaqueId, stored.serialized);
    const now = Date.now();
    if (
      session.id !== sessionId ||
      session.authVersion !== authVersion ||
      isExpired(session, now)
    ) {
      await removeShared(sessionId);
      return null;
    }
    if (!touch) return session;
    const updated = { ...session, lastSeenAt: new Date(now).toISOString() };
    const replaced = await sharedSessionRepository.compareAndSet({
      expected: stored.serialized,
      expiresAt: expiresAt(updated),
      kind: "administrator",
      opaqueId,
      serialized: encryptSharedSession("administrator", opaqueId, updated),
    });
    if (replaced) return updated;
    if (replaced === null) return null;
  }
  return null;
};

const listShared = async (authVersion: number): Promise<readonly AdminSessionRecord[]> => {
  const records = await sharedSessionRepository.list("administrator");
  if (!records) return [];
  const active: AdminSessionRecord[] = [];
  for (const stored of records) {
    const session = decode(stored.opaqueId, stored.serialized);
    if (session.authVersion !== authVersion || isExpired(session, Date.now())) {
      await removeShared(session.id);
    } else {
      active.push(session);
    }
  }
  return active.toSorted((left, right) =>
    right.lastSeenAt.localeCompare(left.lastSeenAt));
};

export const adminSessionStore = {
  clearAll(): void {
    if (sharedStateRedisConfigured()) {
      throw new Error("Use the asynchronous admin-session API with shared state.");
    }
    state.sessions.clear();
  },

  create(input: {
    readonly authVersion: number;
    readonly expiresAt: number;
    readonly id: string;
  }): AdminSessionRecord {
    if (sharedStateRedisConfigured()) {
      throw new Error("Use the asynchronous admin-session API with shared state.");
    }
    const now = new Date().toISOString();
    const session = adminSessionRecordSchema.parse({
      authVersion: input.authVersion,
      createdAt: now,
      expiresAt: new Date(input.expiresAt).toISOString(),
      id: input.id,
      lastSeenAt: now,
    });
    state.sessions.set(session.id, session);
    return session;
  },

  get(
    sessionId: string,
    authVersion: number,
    touch = true,
  ): AdminSessionRecord | null {
    if (sharedStateRedisConfigured()) {
      throw new Error("Use the asynchronous admin-session API with shared state.");
    }
    const now = Date.now();
    prune(now, authVersion);
    const session = state.sessions.get(sessionId);
    if (!session || session.authVersion !== authVersion) return null;
    if (!touch) return session;
    const updated = { ...session, lastSeenAt: new Date(now).toISOString() };
    state.sessions.set(sessionId, updated);
    return updated;
  },

  list(authVersion: number): readonly AdminSessionRecord[] {
    if (sharedStateRedisConfigured()) {
      throw new Error("Use the asynchronous admin-session API with shared state.");
    }
    prune(Date.now(), authVersion);
    return [...state.sessions.values()]
      .filter((session) => session.authVersion === authVersion)
      .toSorted((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  },

  remove(sessionId: string): boolean {
    if (sharedStateRedisConfigured()) {
      throw new Error("Use the asynchronous admin-session API with shared state.");
    }
    return state.sessions.delete(sessionId);
  },

  async clearAllAsync(): Promise<void> {
    if (sharedStateRedisConfigured()) {
      await sharedSessionRepository.clear("administrator");
      return;
    }
    state.sessions.clear();
  },

  async createAsync(input: {
    readonly authVersion: number;
    readonly expiresAt: number;
    readonly id: string;
  }): Promise<AdminSessionRecord> {
    const now = new Date().toISOString();
    const session = adminSessionRecordSchema.parse({
      authVersion: input.authVersion,
      createdAt: now,
      expiresAt: new Date(input.expiresAt).toISOString(),
      id: input.id,
      lastSeenAt: now,
    });
    if (sharedStateRedisConfigured()) {
      const opaqueId = sharedSessionOpaqueId("administrator", session.id);
      await sharedSessionRepository.create({
        expiresAt: expiresAt(session),
        kind: "administrator",
        opaqueId,
        serialized: encryptSharedSession("administrator", opaqueId, session),
      });
    } else {
      state.sessions.set(session.id, session);
    }
    return session;
  },

  async getAsync(
    sessionId: string,
    authVersion: number,
    touch = true,
  ): Promise<AdminSessionRecord | null> {
    if (sharedStateRedisConfigured()) {
      return getShared(sessionId, authVersion, touch);
    }
    const now = Date.now();
    prune(now, authVersion);
    const session = state.sessions.get(sessionId);
    if (!session || session.authVersion !== authVersion) return null;
    if (!touch) return session;
    const updated = { ...session, lastSeenAt: new Date(now).toISOString() };
    state.sessions.set(sessionId, updated);
    return updated;
  },

  async listAsync(authVersion: number): Promise<readonly AdminSessionRecord[]> {
    if (sharedStateRedisConfigured()) return listShared(authVersion);
    prune(Date.now(), authVersion);
    return [...state.sessions.values()]
      .filter((session) => session.authVersion === authVersion)
      .toSorted((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  },

  async removeAsync(sessionId: string): Promise<boolean> {
    if (sharedStateRedisConfigured()) return removeShared(sessionId);
    return state.sessions.delete(sessionId);
  },
};
