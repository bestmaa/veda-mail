import { fetchData } from "@/transport/client/api-request";

export interface AdminSecurityAuditEntry {
  readonly action: string;
  readonly actorId: string;
  readonly actorType: "administrator" | "anonymous" | "member" | "system";
  readonly at: string;
  readonly count: number | null;
  readonly id: string;
  readonly outcome: "attempt" | "challenge" | "failure" | "partial" | "success";
  readonly requestId: string | null;
  readonly sequence: number;
  readonly targetId: string | null;
  readonly targetType: string | null;
}

export interface AdminSecurityAuditPage {
  readonly droppedCount: number;
  readonly entries: readonly AdminSecurityAuditEntry[];
  readonly nextCursor: number | null;
  readonly verifiedAt: string;
}

export const adminSecurityAuditApi = {
  list(input: { readonly beforeSequence?: number; readonly limit?: number } = {}) {
    const query = new URLSearchParams();
    if (input.beforeSequence) query.set("beforeSequence", String(input.beforeSequence));
    if (input.limit) query.set("limit", String(input.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return fetchData<AdminSecurityAuditPage>(
      `/api/v1/admin/audit${suffix}`,
      { cache: "no-store" },
    );
  },
};
