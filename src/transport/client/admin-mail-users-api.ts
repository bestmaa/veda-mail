import type {
  AdminMailUserDetail,
  AdminMailUserSummary,
} from "@/domain/admin/mail-user";
import type { MailForwardingSnapshot } from "@/domain/admin/mail-forwarding";
import { fetchData } from "@/transport/client/api-request";

export type {
  AdminMailUserDetail,
  AdminMailUserSummary,
} from "@/domain/admin/mail-user";

export type AdminMailUsersStatus =
  | "available"
  | "unconfigured"
  | "unsupported";

export interface AdminMailUsersSnapshot {
  readonly adminTwoFactorEnabled: boolean;
  readonly allowedDomains: readonly string[];
  readonly creation: {
    readonly available: boolean;
    readonly reason: string | null;
  };
  readonly nextCursor: string | null;
  readonly status: AdminMailUsersStatus;
  readonly users: readonly AdminMailUserSummary[];
}

export interface CreateAdminMailUserInput {
  readonly confirmPassword: string;
  readonly currentAdminPassword: string;
  readonly displayName?: string;
  readonly email: string;
  readonly otpCode?: string;
  readonly password: string;
}

export interface AdminMailUserLifecycleInput {
  readonly confirmationEmail: string;
  readonly currentAdminPassword: string;
  readonly otpCode?: string;
}

const query = (values: Readonly<Record<string, string | undefined>>): string => {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value) parameters.set(name, value);
  }
  const encoded = parameters.toString();
  return encoded ? `?${encoded}` : "";
};

export const adminMailUsersApi = {
  create(input: CreateAdminMailUserInput, idempotencyKey: string) {
    return fetchData<{
      readonly replayed: boolean;
      readonly user: AdminMailUserDetail;
      readonly warning?: string;
    }>("/api/v1/admin/users", {
      body: JSON.stringify(input),
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST",
    });
  },

  getDetail(accountId: string, domain: string, signal?: AbortSignal) {
    return fetchData<{ readonly user: AdminMailUserDetail }>(
      `/api/v1/admin/users/${encodeURIComponent(accountId)}${query({ domain })}`,
      { cache: "no-store", ...(signal ? { signal } : {}) },
    );
  },

  mutateLifecycle(
    accountId: string,
    domain: string,
    operation: "disable" | "delete",
    input: AdminMailUserLifecycleInput,
    idempotencyKey: string,
  ) {
    return fetchData<{
      readonly email: string;
      readonly forwardingRemoved: boolean;
      readonly outcome: "disabled" | "deleted";
      readonly replayed: boolean;
      readonly sessionsRevoked: number;
      readonly userId: string;
    }>(
      `/api/v1/admin/users/${encodeURIComponent(accountId)}${query({ domain })}`,
      {
        body: JSON.stringify(input),
        headers: { "Idempotency-Key": idempotencyKey },
        method: operation === "delete" ? "DELETE" : "PATCH",
      },
    );
  },

  getForwarding(accountId: string, domain: string, signal?: AbortSignal) {
    return fetchData<MailForwardingSnapshot>(
      `/api/v1/admin/users/${encodeURIComponent(accountId)}/forwarding${query({ domain })}`,
      { cache: "no-store", ...(signal ? { signal } : {}) },
    );
  },

  setForwarding(accountId: string, domain: string, input: {
    readonly confirmDestinationEmail: string;
    readonly currentAdminPassword: string;
    readonly destinationEmail: string;
    readonly expectedRevision: number;
    readonly otpCode?: string;
  }) {
    return fetchData<MailForwardingSnapshot>(
      `/api/v1/admin/users/${encodeURIComponent(accountId)}/forwarding${query({ domain })}`,
      { body: JSON.stringify(input), method: "PUT" },
    );
  },

  removeForwarding(accountId: string, domain: string, input: {
    readonly currentAdminPassword: string;
    readonly expectedRevision: number;
    readonly otpCode?: string;
  }) {
    return fetchData<MailForwardingSnapshot>(
      `/api/v1/admin/users/${encodeURIComponent(accountId)}/forwarding${query({ domain })}`,
      { body: JSON.stringify(input), method: "DELETE" },
    );
  },

  getSnapshot(input: {
    readonly cursor?: string;
    readonly domain?: string;
    readonly search?: string;
  } = {}) {
    return fetchData<AdminMailUsersSnapshot>(
      `/api/v1/admin/users${query(input)}`,
      { cache: "no-store" },
    );
  },
};
