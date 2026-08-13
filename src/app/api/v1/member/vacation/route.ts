import { MAX_VACATION_REQUEST_BYTES } from "@/domain/mail/vacation";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import { assertRequestRateLimit, assertSubjectRateLimit } from "@/server/security/rate-limit";
import { memberAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { parseVacationResponseUpdate } from "@/server/vacation/vacation-schema";
import { updateVacationResponse } from "@/server/vacation/vacation-update.service";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const scopedGateway = async (request: Request) => {
  const connection = await getCurrentConnection();
  assertMailSessionScope(request, connection);
  const gateway = await resolveGateway(connection);
  return { connection, gateway };
};

const workspace = async (request: Request) => {
  const { gateway } = await scopedGateway(request);
  const capability = await gateway.getVacationCapability();
  const delegation = await gateway.getDelegationCapability();
  return {
    capability,
    delegation,
    response: capability.supported ? await gateway.getVacationResponse() : null,
  };
};

export const GET = async (request: Request) => {
  try {
    await assertRequestRateLimit(request, "member-vacation-read", 10_000, 240, 60_000);
    return apiSuccess(await workspace(request));
  } catch (error) {
    return apiFailure(error, "Unable to load automatic-reply settings.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "member-vacation-write", 5_000, 60, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("member-vacation-write", connection.id, 20, 15 * 60_000);
    const input = parseVacationResponseUpdate(
      await readJsonBody(request, MAX_VACATION_REQUEST_BYTES),
    );
    audit = securityAuditOperation({
      action: "member.vacation.updated",
      actor: memberAuditActor(connection),
      targetType: "vacation",
    });
    await audit.attempt();
    const response = await updateVacationResponse(connection, input);
    audit.applied();
    await audit.success();
    return apiSuccess(response);
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to update automatic-reply settings.");
  }
};
