import { MAX_DELEGATION_REQUEST_BYTES } from "@/domain/mail/delegation";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { parseDelegationDelete, parseDelegationUpdate } from "@/server/delegation/delegation-schema";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { memberAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { ApiError } from "@/transport/http/api-error";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(request, "member-delegation-read", 10_000, 180, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const gateway = await resolveGateway(connection);
    const capability = await gateway.getDelegationCapability();
    return apiSuccess({
      capability,
      entries: capability.supported ? await gateway.listDelegations() : [],
    });
  } catch (error) {
    return apiFailure(error, "Unable to load mailbox delegation.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertRequestRateLimit(request, "member-delegation-write", 5_000, 60, 60_000);
    const gateway = await resolveGateway(connection);
    const capability = await gateway.getDelegationCapability();
    if (!capability.supported) throw new ApiError(
      capability.reason, "DELEGATION_PROVIDER_UNSUPPORTED", 422);
    await assertSubjectRateLimit("member-delegation-write", connection.id, 20, 15 * 60_000);
    const input = parseDelegationUpdate(
      await readJsonBody(request, MAX_DELEGATION_REQUEST_BYTES),
    );
    audit = securityAuditOperation({
      action: "member.delegation.updated",
      actor: memberAuditActor(connection),
      targetType: "delegation",
    });
    await audit.attempt();
    let entries;
    try {
      entries = await gateway.updateDelegation(input);
    } catch (error) {
      if (error instanceof ApiError && error.code.startsWith("DELEGATION_CONFIRMATION_")) {
        audit.applied();
      }
      throw error;
    }
    audit.applied();
    await audit.success();
    return apiSuccess(entries);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to update mailbox delegation.");
  }
};

export const DELETE = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertRequestRateLimit(request, "member-delegation-write", 5_000, 60, 60_000);
    const gateway = await resolveGateway(connection);
    const capability = await gateway.getDelegationCapability();
    if (!capability.supported) throw new ApiError(
      capability.reason, "DELEGATION_PROVIDER_UNSUPPORTED", 422);
    await assertSubjectRateLimit("member-delegation-write", connection.id, 20, 15 * 60_000);
    const identifier = parseDelegationDelete(
      await readJsonBody(request, MAX_DELEGATION_REQUEST_BYTES),
    );
    audit = securityAuditOperation({
      action: "member.delegation.deleted",
      actor: memberAuditActor(connection),
      targetType: "delegation",
    });
    await audit.attempt();
    let entries;
    try {
      entries = await gateway.deleteDelegation(identifier);
    } catch (error) {
      if (error instanceof ApiError && error.code.startsWith("DELEGATION_CONFIRMATION_")) {
        audit.applied();
      }
      throw error;
    }
    audit.applied();
    await audit.success();
    return apiSuccess(entries);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to remove mailbox delegation.");
  }
};
