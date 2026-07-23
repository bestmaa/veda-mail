import { NextResponse } from "next/server";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  hasAdminAccess,
  issueAdminToken,
  verifyAdminCredentials,
} from "@/server/auth/admin-session";
import { installationStore } from "@/server/installation/installation.store";
import { adminLoginSchema } from "@/server/installation/installation.schema";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";

export const runtime = "nodejs";

const status = async () => ({
  authenticated: await hasAdminAccess(),
  configured: await installationStore.isInstalled(),
});

export const GET = async () => apiSuccess(await status());

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "admin-login",
      500,
      50,
      15 * 60 * 1000,
    );
    const installation = await installationStore.get();
    if (!installation) {
      throw new ApiError("Complete setup first.", "SETUP_REQUIRED", 503);
    }
    const input = adminLoginSchema.parse(await request.json());
    assertSubjectRateLimit(
      "admin-login",
      input.username.toLowerCase(),
      8,
      15 * 60 * 1000,
    );
    if (
      !(await verifyAdminCredentials(
        input.username,
        input.password,
        installation,
      ))
    ) {
      throw new ApiError(
        "Incorrect administrator username or password.",
        "ADMIN_UNAUTHORIZED",
        401,
      );
    }
    const response = apiSuccess({
      authenticated: true,
      configured: true,
      username: installation.owner.username,
    });
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
    return apiFailure(error, "Unable to sign in as administrator.");
  }
};

export const DELETE = (request: Request) => {
  try {
    assertSameOrigin(request);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(ADMIN_COOKIE, "", {
      ...adminCookieOptions,
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to sign out.");
  }
};
