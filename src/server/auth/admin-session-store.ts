import "server-only";

export const ADMIN_SESSION_IDLE_TTL_SECONDS = 30 * 60;

export interface AdminSessionRecord {
  readonly authVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
}

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

const isExpired = (session: AdminSessionRecord, now: number): boolean =>
  Date.parse(session.expiresAt) <= now || idleExpiresAt(session) <= now;

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

export const adminSessionStore = {
  clearAll(): void {
    state.sessions.clear();
  },

  create(input: {
    readonly authVersion: number;
    readonly expiresAt: number;
    readonly id: string;
  }): AdminSessionRecord {
    const now = new Date().toISOString();
    const session: AdminSessionRecord = {
      authVersion: input.authVersion,
      createdAt: now,
      expiresAt: new Date(input.expiresAt).toISOString(),
      id: input.id,
      lastSeenAt: now,
    };
    state.sessions.set(session.id, session);
    return session;
  },

  get(
    sessionId: string,
    authVersion: number,
    touch = true,
  ): AdminSessionRecord | null {
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
    prune(Date.now(), authVersion);
    return [...state.sessions.values()]
      .filter((session) => session.authVersion === authVersion)
      .toSorted((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
  },

  remove(sessionId: string): boolean {
    return state.sessions.delete(sessionId);
  },
};
