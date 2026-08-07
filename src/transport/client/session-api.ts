import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export interface ManagedSessionSummary {
  readonly clientLabel?: string;
  readonly createdAt: string;
  readonly current?: boolean;
  readonly expiresAt: string;
  readonly id: string;
  readonly lastSeenAt: string;
  readonly ownerReference?: string;
  readonly providerId?: string;
}

export interface MemberSessionsSnapshot {
  readonly policy: {
    readonly absoluteTtlSeconds: number;
    readonly idleTtlSeconds: number;
  };
  readonly sessions: readonly ManagedSessionSummary[];
}

export interface AdminSessionsSnapshot {
  readonly administrator: readonly ManagedSessionSummary[];
  readonly member: readonly ManagedSessionSummary[];
  readonly policy: {
    readonly absoluteTtlSeconds: number;
    readonly adminIdleTtlSeconds: number;
    readonly memberIdleTtlSeconds: number;
  };
}

export const memberSessionsApi = {
  get(sessionScope: string) {
    return fetchData<MemberSessionsSnapshot>("/api/v1/member/sessions", {
      headers: mailSessionScopeHeaders(sessionScope),
    });
  },
  revoke(id: string, sessionScope: string) {
    return fetchData<{ readonly revoked: true; readonly revokedCurrent: boolean }>(
      "/api/v1/member/sessions",
      {
        body: JSON.stringify({ id }),
        headers: mailSessionScopeHeaders(sessionScope),
        method: "DELETE",
      },
    );
  },
};

export const adminSessionsApi = {
  get() {
    return fetchData<AdminSessionsSnapshot>("/api/v1/admin/sessions");
  },
  revoke(id: string, kind: "administrator" | "member") {
    return fetchData<{ readonly revoked: true; readonly revokedCurrent: boolean }>(
      "/api/v1/admin/sessions",
      { body: JSON.stringify({ id, kind }), method: "DELETE" },
    );
  },
};
