import { z } from "zod";

import { sessionManagementId } from "@/server/auth/session-management";
import {
  CONNECTION_COOKIE,
  getCurrentConnection,
} from "@/server/connections/connection-session";
import {
  MEMBER_CONNECTION_IDLE_TTL_MS,
  MEMBER_CONNECTION_TTL_SECONDS,
} from "@/server/connections/connection-lifetime";
import { storedConnectionExpiresAt } from "@/server/connections/connection-session-record";
import { connectionStore } from "@/server/connections/connection-store";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { memberCookieOptions } from "@/server/connections/member-session-response";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  appendSecurityAudit,
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const revokeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
}).strict();

export const GET = async (request: Request) => {
  try {
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const stored = connectionStore.get(connection.id);
    if (!stored) {
      throw new ApiError("This mail connection expired.", "MEMBER_SESSION_EXPIRED", 401);
    }
    assertRequestRateLimit(request, "member-session-management", 10_000, 240, 60_000);
    assertSubjectRateLimit("member-session-management", connection.id, 120, 60_000);
    return apiSuccess({
      policy: {
        absoluteTtlSeconds: MEMBER_CONNECTION_TTL_SECONDS,
        idleTtlSeconds: MEMBER_CONNECTION_IDLE_TTL_MS / 1_000,
      },
      sessions: connectionStore.listForOwner(stored.ownerKey).map((candidate) => ({
        clientLabel: candidate.clientLabel,
        createdAt: candidate.connection.createdAt,
        current: candidate.connection.id === connection.id,
        expiresAt: new Date(storedConnectionExpiresAt(candidate)!).toISOString(),
        id: sessionManagementId("member", candidate.connection.id),
        lastSeenAt: candidate.lastSeenAt,
      })),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load mailbox sessions.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    const stored = connectionStore.get(connection.id);
    if (!stored) {
      throw new ApiError("This mail connection expired.", "MEMBER_SESSION_EXPIRED", 401);
    }
    assertRequestRateLimit(request, "member-session-management", 10_000, 240, 60_000);
    assertSubjectRateLimit("member-session-management", connection.id, 120, 60_000);
    const input = revokeSchema.parse(await readJsonBody(request, 4 * 1_024));
    const target = connectionStore.listForOwner(stored.ownerKey).find((candidate) =>
      sessionManagementId("member", candidate.connection.id) === input.id,
    );
    if (!target) {
      throw new ApiError("That session is no longer active.", "SESSION_NOT_FOUND", 404);
    }
    const revokedCurrent = target.connection.id === connection.id;
    try {
      await appendSecurityAudit({
        action: "member.session.revoked",
        actor: memberAuditActor(connection),
        outcome: "success",
        targetId: input.id,
        targetType: "session",
      });
    } finally {
      connectionStore.remove(target.connection.id);
    }
    const response = apiSuccess({ revoked: true, revokedCurrent });
    if (revokedCurrent) {
      response.cookies.set(CONNECTION_COOKIE, "", {
        ...memberCookieOptions,
        maxAge: 0,
      });
    }
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to revoke this mailbox session.");
  }
};
