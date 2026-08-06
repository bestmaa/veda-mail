import "server-only";

import type { ProviderConnection } from "@/domain/provider/provider";
import { currentRequestId } from "@/server/observability/request-log";
import { securityAuditSubjectId } from "@/server/security-audit/security-audit-key";
import type {
  SecurityAuditAction,
  SecurityAuditAppend,
} from "@/server/security-audit/security-audit-record";
import { securityAuditStore } from "@/server/security-audit/security-audit.store";

export interface SecurityAuditActor {
  readonly actorId: string;
  readonly actorType: SecurityAuditAppend["actorType"];
}

export const anonymousAuditActor = (subject: string): SecurityAuditActor => ({
  actorId: securityAuditSubjectId("actor", `anonymous:${subject}`),
  actorType: "anonymous",
});

export const administratorAuditActor = (username: string): SecurityAuditActor => ({
  actorId: securityAuditSubjectId("actor", `administrator:${username}`),
  actorType: "administrator",
});

export const installationAdministratorAuditActor = (): SecurityAuditActor => ({
  actorId: securityAuditSubjectId("actor", "administrator:installation-owner"),
  actorType: "administrator",
});

export const memberAuditActor = (
  connection: Pick<ProviderConnection, "id" | "providerId">,
): SecurityAuditActor => ({
  actorId: securityAuditSubjectId(
    "actor",
    `member:${connection.providerId}:${connection.id}`,
  ),
  actorType: "member",
});

export const memberIdentityAuditActor = (
  email: string,
  providerId: string,
): SecurityAuditActor => ({
  actorId: securityAuditSubjectId("actor", `member:${providerId}:${email}`),
  actorType: "member",
});

export const auditTargetId = (type: string, value: string): string =>
  securityAuditSubjectId("target", `${type}:${value}`);

export const appendSecurityAudit = async (input: {
  readonly action: SecurityAuditAction;
  readonly actor: SecurityAuditActor;
  readonly count?: number;
  readonly outcome: SecurityAuditAppend["outcome"];
  readonly targetId?: string;
  readonly targetType?: SecurityAuditAppend["targetType"];
}) => securityAuditStore.append({
  action: input.action,
  actorId: input.actor.actorId,
  actorType: input.actor.actorType,
  count: input.count ?? null,
  outcome: input.outcome,
  requestId: (await currentRequestId()) ?? null,
  targetId: input.targetId ?? null,
  targetType: input.targetType ?? null,
});
