import type {
  MailRuleBook,
  MailRulePutOperation,
  RuleCapability,
  RulePreviewInput,
  RulePreviewResult,
} from "@/domain/mail/rule";
import { fetchData } from "@/transport/client/api-request";
import { mailSessionScopeHeaders } from "@/transport/client/mail-session-scope";

export interface MailRuleDeploymentSnapshot {
  readonly errorCode: string | null;
  readonly status: "conflict" | "deployed" | "failed" | "pending" | "undeployed";
  readonly updatedAt: string;
}

export interface MailRuleBookSnapshot extends MailRuleBook {
  readonly deployment: MailRuleDeploymentSnapshot;
}

export interface MailRuleWorkspaceSnapshot {
  readonly book: MailRuleBookSnapshot;
  readonly capability: RuleCapability;
}

const endpoint = "/api/v1/member/rules";
const request = <T>(
  sessionScope: string,
  init: RequestInit,
  path = endpoint,
): Promise<T> => fetchData<T>(path, {
  cache: "no-store",
  credentials: "same-origin",
  ...init,
  headers: {
    ...mailSessionScopeHeaders(sessionScope),
    ...init.headers,
  },
});

export const memberRuleApi = {
  get(sessionScope: string, signal?: AbortSignal) {
    return request<MailRuleWorkspaceSnapshot>(sessionScope, {
      method: "GET", ...(signal ? { signal } : {}),
    });
  },

  put(operation: MailRulePutOperation, sessionScope: string) {
    return request<MailRuleBookSnapshot>(sessionScope, {
      body: JSON.stringify(operation),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
  },

  preview(input: RulePreviewInput, sessionScope: string) {
    return request<readonly RulePreviewResult[]>(sessionScope, {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }, `${endpoint}/preview`);
  },

  reconcile(expectedRevision: string, sessionScope: string) {
    return request<MailRuleBookSnapshot>(sessionScope, {
      body: JSON.stringify({ expectedRevision }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }, `${endpoint}/reconcile`);
  },
};
