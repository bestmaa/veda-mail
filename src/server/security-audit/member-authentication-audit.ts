import "server-only";

import {
  anonymousAuditActor,
  appendSecurityAudit,
  memberIdentityAuditActor,
  type SecurityAuditActor,
} from "@/server/security-audit/security-audit";

export const memberAuthenticationAudit = () => {
  let actor: SecurityAuditActor | null = null;
  let recorded = false;
  const append = async (
    action: "member.authentication.challenge" |
      "member.authentication.failed" |
      "member.authentication.succeeded",
    outcome: "challenge" | "failure" | "success",
  ) => {
    if (!actor) return;
    await appendSecurityAudit({
      action,
      actor,
      outcome,
      targetType: "authentication",
    });
    recorded = true;
  };
  return {
    challenge: () => append("member.authentication.challenge", "challenge"),
    failure: () => append("member.authentication.failed", "failure"),
    identify(email: string) {
      actor = anonymousAuditActor(email);
    },
    async recordFailureIfPending() {
      if (actor && !recorded) await append("member.authentication.failed", "failure");
    },
    succeed(email: string, providerId: string) {
      actor = memberIdentityAuditActor(email, providerId);
      return append("member.authentication.succeeded", "success");
    },
  };
};
