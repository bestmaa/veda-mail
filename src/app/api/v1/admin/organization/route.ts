import { assertAdminAccess } from "@/server/auth/admin-session";
import {
  removeBrandLogo,
  writeBrandLogo,
} from "@/server/branding/logo-store";
import { parseOrganizationForm } from "@/server/branding/organization-form";
import { readMultipartFormData } from "@/server/http/multipart-form";
import { installationStore } from "@/server/installation/installation.store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { installationAdministratorAuditActor } from "@/server/security-audit/security-audit";
import { securityAuditOperation } from "@/server/security-audit/security-audit-operation";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    await assertAdminAccess();
    return apiSuccess(await installationStore.getBranding());
  } catch (error) {
    return apiFailure(error, "Unable to load organization settings.");
  }
};

export const PUT = async (request: Request) => {
  let audit: ReturnType<typeof securityAuditOperation> | null = null;
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    await assertRequestRateLimit(
      request,
      "admin-organization",
      1_000,
      100,
      10 * 60 * 1000,
    );
    await assertSubjectRateLimit(
      "admin-organization",
      "administrator",
      20,
      10 * 60 * 1000,
    );
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
    }
    const parsed = await parseOrganizationForm(
      await readMultipartFormData(request),
      installation.organization,
    );
    audit = securityAuditOperation({
      action: "admin.organization.updated",
      actor: installationAdministratorAuditActor(),
      targetType: "organization",
    });
    await audit.attempt();
    const result = await installationStore.updateBranding(async (current) => {
      const logoFileName = parsed.logo
        ? await writeBrandLogo(parsed.logo)
        : parsed.logo === null
          ? null
          : current.logoFileName;
      return { ...parsed.organization, logoFileName };
    });
    const previousLogo = result.previous.logoFileName;
    if (
      previousLogo &&
      previousLogo !== result.updated.organization.logoFileName
    ) {
      await removeBrandLogo(previousLogo).catch(() => undefined);
    }
    audit.applied();
    await audit.success();
    return apiSuccess(await installationStore.getBranding());
  } catch (error) {
    await audit?.failureIfPending();
    return apiFailure(error, "Unable to save organization settings.");
  }
};
