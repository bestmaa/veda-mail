import "server-only";

import {
  appendSecurityAudit,
  type SecurityAuditActor,
} from "@/server/security-audit/security-audit";
import type {
  SecurityAuditAction,
  SecurityAuditAppend,
} from "@/server/security-audit/security-audit-record";

interface OperationInput {
  readonly action: SecurityAuditAction;
  readonly actor: SecurityAuditActor;
  readonly count?: number;
  readonly targetId?: string;
  readonly targetType?: SecurityAuditAppend["targetType"];
}

export const securityAuditOperation = (input: OperationInput) => {
  let applied = false;
  let finished = false;
  let started = false;
  const append = (
    outcome: SecurityAuditAppend["outcome"],
    count?: number,
  ) => appendSecurityAudit({
    ...input,
    ...(count === undefined ? {} : { count }),
    outcome,
  });
  return {
    applied() {
      applied = true;
    },
    async attempt() {
      await append("attempt");
      started = true;
    },
    async failureIfPending() {
      if (!started || finished) return;
      await append(applied ? "partial" : "failure");
      finished = true;
    },
    async partial(count?: number) {
      await append("partial", count);
      finished = true;
    },
    async success(count?: number) {
      await append("success", count);
      finished = true;
    },
  };
};
