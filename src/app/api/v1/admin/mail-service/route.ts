import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { ProviderModule } from "@/application/ports/mail-provider.port";
import type { ProviderId } from "@/domain/shared/brand";
import {
  ADMIN_COOKIE,
  assertAdminAccess,
} from "@/server/auth/admin-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  mailServiceProfileInputSchema,
} from "@/server/mail-service/mail-service-profile.schema";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import {
  assertRequestRateLimit,
  assertSessionRateLimit,
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
    await assertAdminAccess();
    return apiSuccess({
      configuration: await mailServiceProfileStore.get(),
      providers: getProviderRegistry().list(),
    });
  } catch (error) {
    return apiFailure(error, "Unable to load mail-service settings.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-mail-service",
      1_000,
      100,
      10 * 60 * 1000,
    );
    assertSessionRateLimit(
      request,
      "admin-mail-service",
      ADMIN_COOKIE,
      20,
      10 * 60 * 1000,
    );
    const input = mailServiceProfileInputSchema.parse(await request.json());
    const provider = findProvider(input.providerId);
    const config = await provider.validateServiceConfig(input.config);
    const configuration = await mailServiceProfileStore.put({
      ...input,
      config,
    });
    connectionStore.clearAll();
    return apiSuccess({
      configuration,
      providers: getProviderRegistry().list(),
    });
  } catch (error) {
    return apiFailure(error, "Unable to save mail-service settings.");
  }
};
