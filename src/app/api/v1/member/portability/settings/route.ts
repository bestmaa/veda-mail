import {
  MAX_SETTINGS_PORTABILITY_BYTES,
} from "@/domain/member/settings-portability";
import { getCurrentConnection } from "@/server/connections/connection-session";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  exportPortableSettings,
  importPortableSettings,
} from "@/server/portability/settings-portability.service";
import {
  parseSettingsPortabilityBundle,
} from "@/server/portability/settings-portability";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import {
  appendSecurityAudit,
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

export const GET = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "member-settings-export", 10_000, 30, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("member-settings-export", connection.id, 10, 15 * 60_000);
    const bundle = await exportPortableSettings(connection);
    await appendSecurityAudit({
      action: "member.settings.exported",
      actor: memberAuditActor(connection),
      count: bundle.rules.length,
      outcome: "success",
      targetType: "settings",
    });
    return new Response(`${JSON.stringify(bundle, null, 2)}\n`, { headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="veda-mail-settings.json"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return apiFailure(error, "Unable to export settings.");
  }
};

export const POST = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertRequestRateLimit(request, "member-settings-import", 10_000, 20, 60_000);
    const connection = await getCurrentConnection();
    assertMailSessionScope(request, connection);
    await assertSubjectRateLimit("member-settings-import", connection.id, 5, 15 * 60_000);
    audit = securityAuditOperation({
      action: "member.settings.imported",
      actor: memberAuditActor(connection),
      targetType: "settings",
    });
    await audit.attempt();
    await importPortableSettings(
      connection,
      parseSettingsPortabilityBundle(await readJsonBody(
        request,
        MAX_SETTINGS_PORTABILITY_BYTES,
      )),
    );
    audit.applied();
    await audit.success();
    return apiSuccess({ imported: true });
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to import settings.");
  }
};
