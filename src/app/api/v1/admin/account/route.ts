import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  assertAdminAccess,
  issueAdminToken,
} from "@/server/auth/admin-session";
import {
  adminAccountUpdateSchema,
} from "@/server/installation/installation.schema";
import { installationStore } from "@/server/installation/installation.store";
import {
  hashAdminPassword,
  verifyAdminPasswordDigest,
} from "@/server/installation/password-hash";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSessionRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

export const GET = async () => {
  try {
    await assertAdminAccess();
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
    }
    return apiSuccess({ username: installation.owner.username });
  } catch (error) {
    return apiFailure(error, "Unable to load administrator account.");
  }
};

export const PUT = async (request: Request) => {
  try {
    assertSameOrigin(request);
    await assertAdminAccess();
    assertRequestRateLimit(
      request,
      "admin-account",
      500,
      50,
      30 * 60 * 1000,
    );
    assertSessionRateLimit(
      request,
      "admin-account",
      ADMIN_COOKIE,
      8,
      30 * 60 * 1000,
    );
    const input = adminAccountUpdateSchema.parse(await request.json());
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
    }
    if (
      !(await verifyAdminPasswordDigest(
        input.currentPassword,
        installation.owner.password,
      ))
    ) {
      throw new ApiError(
        "Current administrator password is incorrect.",
        "ADMIN_UNAUTHORIZED",
        401,
      );
    }
    const password = input.newPassword
      ? await hashAdminPassword(input.newPassword)
      : installation.owner.password;
    const updated = await installationStore.updateOwner(
      installation.owner.authVersion,
      { password, username: input.username },
    );
    const response = apiSuccess({ username: updated.owner.username });
    response.cookies.set(
      ADMIN_COOKIE,
      await issueAdminToken(updated),
      {
        ...adminCookieOptions,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to update administrator account.");
  }
};
