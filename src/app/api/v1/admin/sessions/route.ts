import { z } from "zod";

import {
  ADMIN_COOKIE,
  adminCookieOptions,
  assertAdminAccess,
  getCurrentAdminSessionId,
} from "@/server/auth/admin-session";
import {
  ADMIN_SESSION_IDLE_TTL_SECONDS,
  adminSessionStore,
} from "@/server/auth/admin-session-store";
import { sessionManagementId } from "@/server/auth/session-management";
import {
  MEMBER_CONNECTION_IDLE_TTL_MS,
  MEMBER_CONNECTION_TTL_SECONDS,
} from "@/server/connections/connection-lifetime";
import { storedConnectionExpiresAt } from "@/server/connections/connection-session-record";
import { connectionStore } from "@/server/connections/connection-store";
import { installationStore } from "@/server/installation/installation.store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  appendSecurityAudit,
  installationAdministratorAuditActor,
} from "@/server/security-audit/security-audit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const revokeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  kind: z.enum(["administrator", "member"]),
}).strict();

const installation = async () => {
  const current = await installationStore.get();
  if (!current) {
    throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
  }
  return current;
};

const limits = async (request: Request): Promise<void> => {
  await assertRequestRateLimit(
    request,
    "admin-session-management",
    5_000,
    120,
    60_000,
  );
  await assertSubjectRateLimit(
    "admin-session-management",
    "administrator",
    120,
    60_000,
  );
};

export const GET = async (request: Request) => {
  try {
    await assertAdminAccess();
    await limits(request);
    const current = await installation();
    const currentSessionId = await getCurrentAdminSessionId();
    return apiSuccess({
      administrator: (await adminSessionStore.listAsync(current.owner.authVersion)).map((session) => ({
        createdAt: session.createdAt,
        current: session.id === currentSessionId,
        expiresAt: new Date(Math.min(
          Date.parse(session.expiresAt),
          Date.parse(session.lastSeenAt) + ADMIN_SESSION_IDLE_TTL_SECONDS * 1_000,
        )).toISOString(),
        id: sessionManagementId("administrator", session.id),
        lastSeenAt: session.lastSeenAt,
      })),
      member: (await connectionStore.listAllAsync()).map((stored) => ({
        clientLabel: stored.clientLabel,
        createdAt: stored.connection.createdAt,
        expiresAt: new Date(storedConnectionExpiresAt(stored)!).toISOString(),
        id: sessionManagementId("member", stored.connection.id),
        lastSeenAt: stored.lastSeenAt,
        ownerReference: stored.ownerKey.slice(0, 12),
        providerId: stored.connection.providerId,
      })),
      policy: {
        absoluteTtlSeconds: MEMBER_CONNECTION_TTL_SECONDS,
        adminIdleTtlSeconds: ADMIN_SESSION_IDLE_TTL_SECONDS,
        memberIdleTtlSeconds: MEMBER_CONNECTION_IDLE_TTL_MS / 1_000,
      },
    });
  } catch (error) {
    return apiFailure(error, "Unable to load active sessions.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    await limits(request);
    const current = await installation();
    const currentSessionId = await getCurrentAdminSessionId();
    const input = revokeSchema.parse(await readJsonBody(request, 4 * 1_024));
    let revokedCurrent = false;
    if (input.kind === "administrator") {
      const target = (await adminSessionStore.listAsync(current.owner.authVersion)).find((session) =>
        sessionManagementId("administrator", session.id) === input.id,
      );
      if (!target) {
        throw new ApiError("That session is no longer active.", "SESSION_NOT_FOUND", 404);
      }
      revokedCurrent = target.id === currentSessionId;
      await adminSessionStore.removeAsync(target.id);
    } else {
      const target = (await connectionStore.listAllAsync()).find((stored) =>
        sessionManagementId("member", stored.connection.id) === input.id,
      );
      if (!target) {
        throw new ApiError("That session is no longer active.", "SESSION_NOT_FOUND", 404);
      }
      await connectionStore.removeAsync(target.connection.id);
    }
    await appendSecurityAudit({
      action: "admin.session.revoked",
      actor: installationAdministratorAuditActor(),
      outcome: "success",
      targetId: input.id,
      targetType: "session",
    });
    const response = apiSuccess({ revoked: true, revokedCurrent });
    if (revokedCurrent) {
      response.cookies.set(ADMIN_COOKIE, "", { ...adminCookieOptions, maxAge: 0 });
    }
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to revoke this session.");
  }
};
