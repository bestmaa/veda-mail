import { NextResponse } from "next/server";

import {
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  hasAdminAccess,
  issueAdminToken,
  revokeCurrentAdminSession,
  verifyAdminCredentials,
} from "@/server/auth/admin-session";
import {
  verifyAdminSecondFactor,
  withoutRecoveryCode,
} from "@/server/auth/admin-two-factor";
import { installationStore } from "@/server/installation/installation.store";
import { adminLoginSchema } from "@/server/installation/installation.schema";
import { assertSameOrigin } from "@/server/installation/request-origin";
import {
  assertAuthenticationRequestRateLimit,
  assertAuthenticationSubjectRateLimit,
} from "@/server/security/authentication-rate-limit";
import {
  administratorAuditActor,
  anonymousAuditActor,
  appendSecurityAudit,
  type SecurityAuditActor,
} from "@/server/security-audit/security-audit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";

export const runtime = "nodejs";

const MAX_ADMIN_LOGIN_BODY_BYTES = 16 * 1024;

const status = async () => ({
  authenticated: await hasAdminAccess(),
  configured: await installationStore.isInstalled(),
});

export const GET = async () => apiSuccess(await status());

export const POST = async (request: Request) => {
  let actor: SecurityAuditActor | null = null;
  let recorded = false;
  try {
    assertSameOrigin(request);
    await assertAuthenticationRequestRateLimit(
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
    const input = adminLoginSchema.parse(
      await readJsonBody(request, MAX_ADMIN_LOGIN_BODY_BYTES),
    );
    actor = anonymousAuditActor(input.username);
    await assertAuthenticationSubjectRateLimit(
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
      await appendSecurityAudit({
        action: "admin.authentication.failed", actor,
        outcome: "failure", targetType: "authentication",
      });
      recorded = true;
      throw new ApiError(
        "Incorrect administrator username or password.",
        "ADMIN_UNAUTHORIZED",
        401,
      );
    }
    actor = administratorAuditActor(installation.owner.username);
    if (installation.owner.twoFactor && !input.otpCode) {
      await appendSecurityAudit({
        action: "admin.authentication.challenge", actor,
        outcome: "challenge", targetType: "authentication",
      });
      recorded = true;
      return apiSuccess(
        {
          authenticated: false,
          configured: true,
          mfaRequired: true,
        },
        { status: 202 },
      );
    }
    let activeInstallation = installation;
    if (installation.owner.twoFactor) {
      const secondFactor = verifyAdminSecondFactor(
        input.otpCode ?? "",
        installation.owner.twoFactor,
        installation.sessionSecret,
      );
      if (!secondFactor.valid) {
        await appendSecurityAudit({
          action: "admin.authentication.failed", actor,
          outcome: "failure", targetType: "authentication",
        });
        recorded = true;
        throw new ApiError(
          "Incorrect administrator credentials or verification code.",
          "ADMIN_UNAUTHORIZED",
          401,
        );
      }
      if (secondFactor.recoveryCodeIndex !== null) {
        activeInstallation = await installationStore.updateOwner(
          installation.owner.authVersion,
          {
            password: installation.owner.password,
            twoFactor: withoutRecoveryCode(
              installation.owner.twoFactor,
              secondFactor.recoveryCodeIndex,
            ),
            username: installation.owner.username,
          },
        );
      }
    }
    await appendSecurityAudit({
      action: "admin.authentication.succeeded", actor,
      outcome: "success", targetType: "authentication",
    });
    recorded = true;
    const response = apiSuccess({
      authenticated: true,
      configured: true,
      username: activeInstallation.owner.username,
    });
    response.cookies.set(
      ADMIN_COOKIE,
      await issueAdminToken(activeInstallation),
      {
        ...adminCookieOptions,
        maxAge: ADMIN_SESSION_TTL_SECONDS,
      },
    );
    return response;
  } catch (error) {
    if (actor && !recorded) {
      await appendSecurityAudit({
        action: "admin.authentication.failed", actor,
        outcome: "failure", targetType: "authentication",
      });
    }
    return apiFailure(error, "Unable to sign in as administrator.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    const installation = await installationStore.get();
    if (installation && await hasAdminAccess()) {
      try {
        await appendSecurityAudit({
          action: "admin.authentication.signed-out",
          actor: administratorAuditActor(installation.owner.username),
          outcome: "success",
          targetType: "session",
        });
      } finally {
        await revokeCurrentAdminSession();
      }
    }
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
