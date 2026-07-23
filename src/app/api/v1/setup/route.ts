import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type { ProviderId } from "@/domain/shared/brand";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  issueAdminToken,
} from "@/server/auth/admin-session";
import { writeBrandLogo } from "@/server/branding/logo-store";
import { connectionStore } from "@/server/connections/connection-store";
import { readMultipartFormData } from "@/server/http/multipart-form";
import { hashAdminPassword } from "@/server/installation/password-hash";
import { installationStore } from "@/server/installation/installation.store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { parseSetupForm } from "@/server/installation/setup-form";
import { assertSetupToken } from "@/server/installation/setup-token";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

const findProvider = (providerId: ProviderId): ProviderModule => {
  try {
    return getProviderRegistry().get(providerId);
  } catch {
    throw new ApiError("Unknown mail provider.", "UNKNOWN_PROVIDER", 400);
  }
};

export const GET = async () => {
  try {
    return apiSuccess({
      installationRequired: !(await installationStore.isInstalled()),
      providers: getProviderRegistry().list(),
      setupTokenConfigured:
        (process.env["VEDA_MAIL_SETUP_TOKEN"]?.length ?? 0) >= 24,
    });
  } catch (error) {
    return apiFailure(error, "Unable to read setup status.");
  }
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "first-run-setup",
      200,
      30,
      30 * 60 * 1000,
    );
    if (await installationStore.isInstalled()) {
      throw new ApiError(
        "First-run setup has already been completed.",
        "SETUP_ALREADY_COMPLETED",
        409,
      );
    }
    const parsed = await parseSetupForm(await readMultipartFormData(request));
    assertSubjectRateLimit(
      "first-run-setup",
      parsed.setupToken,
      8,
      30 * 60 * 1000,
    );
    assertSetupToken(parsed.setupToken);
    const provider = findProvider(parsed.mailProfile.providerId);
    const config = await provider.validateServiceConfig(
      parsed.mailProfile.config,
    );
    const password = await hashAdminPassword(parsed.adminPassword);
    const installation = await installationStore.complete(async () => {
      if (parsed.logo) {
        await writeBrandLogo(parsed.logo);
      }
      return {
        mailProfile: { ...parsed.mailProfile, config },
        organization: parsed.organization,
        owner: { password, username: parsed.adminUsername },
      };
    });
    connectionStore.clearAll();
    const response = apiSuccess(
      {
        admin: { username: installation.owner.username },
        branding: await installationStore.getBranding(),
        installationRequired: false,
      },
      { status: 201 },
    );
    response.cookies.set(
      ADMIN_COOKIE,
      await issueAdminToken(installation),
      {
        ...adminCookieOptions,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to complete first-run setup.");
  }
};
