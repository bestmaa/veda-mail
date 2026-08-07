import { NextResponse } from "next/server";
import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { MailAccount } from "@/domain/mail/mail";
import type { MailServiceProfile, ProviderConnection } from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import {
  CONNECTION_COOKIE,
  getCurrentConnection,
} from "@/server/connections/connection-session";
import { MEMBER_CONNECTION_TTL_SECONDS } from "@/server/connections/connection-lifetime";
import { connectionStore } from "@/server/connections/connection-store";
import { assertMailSessionScope } from "@/server/connections/mail-session-scope";
import {
  memberSessionClientLabel,
  memberSessionOwnerKey,
} from "@/server/connections/member-session-metadata";
import {
  anonymousMemberSession,
  memberCookieOptions,
  memberSessionResponse,
} from "@/server/connections/member-session-response";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import {
  emailDomain,
  memberCredentialsSchema,
} from "@/server/mail-service/mail-service-profile.schema";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import {
  assertAuthenticationRequestRateLimit,
  assertAuthenticationSubjectRateLimit,
} from "@/server/security/authentication-rate-limit";
import {
  appendSecurityAudit,
  memberAuditActor,
} from "@/server/security-audit/security-audit";
import { memberAuthenticationAudit } from "@/server/security-audit/member-authentication-audit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";

export const runtime = "nodejs";
const MAX_MEMBER_LOGIN_BODY_BYTES = 16 * 1024;
const activeProfile = async (): Promise<MailServiceProfile> => {
  const profile = await mailServiceProfileStore.get();
  if (!profile) {
    throw new ApiError(
      "The mail service is not configured.",
      "MAIL_SERVICE_NOT_CONFIGURED",
      503,
    );
  }
  return profile;
};

export const GET = async () => {
  try {
    const connection = await getCurrentConnection();
    const account = await (await resolveGateway(connection)).getAccount();
    const profile = await activeProfile();
    if (!connectionStore.isActive(connection)) {
      throw new ApiError(
        "This mail connection expired. Connect the account again.",
        "MEMBER_SESSION_EXPIRED",
        401,
      );
    }
    return apiSuccess(memberSessionResponse(account, profile));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const response = apiSuccess(anonymousMemberSession);
      response.cookies.set(CONNECTION_COOKIE, "", {
        ...memberCookieOptions,
        maxAge: 0,
      });
      return response;
    }
    return apiFailure(error, "Unable to read the member session.");
  }
};

export const POST = async (request: Request) => {
  const authenticationAudit = memberAuthenticationAudit();
  try {
    assertSameOrigin(request);
    await assertAuthenticationRequestRateLimit(
      request,
      "member-login",
      2_000,
      100,
      15 * 60 * 1000,
    );
    const credentials = memberCredentialsSchema.parse(
      await readJsonBody(request, MAX_MEMBER_LOGIN_BODY_BYTES),
    );
    authenticationAudit.identify(credentials.email);
    await assertAuthenticationSubjectRateLimit(
      "member-login",
      credentials.email.toLowerCase(),
      10,
      15 * 60 * 1000,
    );
    const profile = await activeProfile();
    const profileRevision = mailServiceProfileRevision(profile);
    if (!profile.allowedDomains.includes(emailDomain(credentials.email))) {
      await authenticationAudit.failure();
      throw new ApiError(
        "Incorrect email address or password.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    const provider = getProviderRegistry().get(profile.providerId);
    const authentication = await provider.authenticateMember(
      profile.config,
      {
        email: credentials.email,
        password: credentials.password,
        ...(credentials.otpCode ? { otpCode: credentials.otpCode } : {}),
      },
    );
    if (authentication.status === "mfa-required") {
      await authenticationAudit.challenge();
      return apiSuccess(
        { authenticated: false, mfaRequired: true },
        { status: 202 },
      );
    }
    if (authentication.status === "rejected") {
      await authenticationAudit.failure();
      throw new ApiError(
        "Incorrect email address, password or verification code.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    if (await memberTwoFactorSecurity.isEnabled(credentials.email)) {
      if (!credentials.otpCode) {
        await authenticationAudit.challenge();
        return apiSuccess(
          { authenticated: false, mfaRequired: true },
          { status: 202 },
        );
      }
      if (
        !(await memberTwoFactorSecurity.verify(
          credentials.email,
          credentials.otpCode,
        ))
      ) {
        await authenticationAudit.failure();
        throw new ApiError(
          "Incorrect email address, password or verification code.",
          "INVALID_MEMBER_CREDENTIALS",
          401,
        );
      }
    }
    const { config } = authentication;
    const candidate: ProviderConnection = {
      config,
      createdAt: new Date().toISOString(),
      displayName: profile.displayName,
      id: id.connection(crypto.randomUUID()),
      providerId: profile.providerId,
    };
    let account: MailAccount;
    try {
      const gateway = await provider.createGateway(candidate);
      await gateway.testConnection();
      account = await gateway.getAccount();
    } catch {
      throw new ApiError(
        "Incorrect email address or password.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    if (account.email.toLowerCase() !== credentials.email.toLowerCase()) {
      await authenticationAudit.failure();
      throw new ApiError(
        "Incorrect email address or password.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    const previous = await getCurrentConnection().catch(() => null);
    await authenticationAudit.succeed(credentials.email, profile.providerId);
    const connection = connectionStore.create(
      {
        config,
        displayName: profile.displayName,
        providerId: profile.providerId,
      },
      profileRevision,
      {
        clientLabel: memberSessionClientLabel(request),
        ownerKey: memberSessionOwnerKey(credentials.email),
      },
    );
    if (previous) {
      connectionStore.remove(previous.id);
    }
    const response = apiSuccess(memberSessionResponse(account, profile), {
      status: 201,
    });
    response.cookies.set(CONNECTION_COOKIE, connection.id, {
      ...memberCookieOptions,
      maxAge: MEMBER_CONNECTION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    await authenticationAudit.recordFailureIfPending();
    return apiFailure(error, "Unable to sign in to this mailbox.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection().catch(() => null);
    if (connection) {
      assertMailSessionScope(request, connection);
      const auditActor = memberAuditActor(connection);
      try {
        await appendSecurityAudit({
          action: "member.authentication.signed-out",
          actor: auditActor,
          outcome: "success",
          targetType: "session",
        });
      } finally {
        twoFactorEnrollmentStore.remove(connection.id);
        connectionStore.remove(connection.id);
      }
    }
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(CONNECTION_COOKIE, "", {
      ...memberCookieOptions,
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to sign out.");
  }
};
