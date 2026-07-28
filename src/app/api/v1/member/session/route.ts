import { NextResponse } from "next/server";

import { getProviderRegistry } from "@/bootstrap/provider-registry";
import type { MailAccount } from "@/domain/mail/mail";
import type {
  MailServiceProfile,
  ProviderConnection,
} from "@/domain/provider/provider";
import { id } from "@/domain/shared/brand";
import {
  CONNECTION_COOKIE,
  getCurrentConnection,
} from "@/server/connections/connection-session";
import { connectionStore } from "@/server/connections/connection-store";
import { assertSameOrigin } from "@/server/installation/request-origin";
import { resolveGateway } from "@/server/mail/gateway-cache";
import {
  emailDomain,
  memberCredentialsSchema,
} from "@/server/mail-service/mail-service-profile.schema";
import { mailServiceProfileRevision } from "@/server/mail-service/mail-service-profile-revision";
import { mailServiceProfileStore } from "@/server/mail-service/mail-service-profile.store";
import {
  assertRequestRateLimit,
  assertSubjectRateLimit,
} from "@/server/security/rate-limit";
import { ApiError } from "@/transport/http/api-error";
import { apiFailure, apiSuccess } from "@/transport/http/api-response";
import { readJsonBody } from "@/transport/http/read-json-body";
import { twoFactorEnrollmentStore } from "@/server/auth/two-factor-enrollment";
import { memberTwoFactorSecurity } from "@/server/auth/member-two-factor";

export const runtime = "nodejs";

const MEMBER_SESSION_TTL_SECONDS = 60 * 60 * 12;
const MAX_MEMBER_LOGIN_BODY_BYTES = 16 * 1024;

const anonymousSession = {
  account: null,
  authenticated: false,
  service: null,
} as const;

const memberSession = (
  account: MailAccount,
  profile: Pick<MailServiceProfile, "displayName" | "providerId">,
) => ({
  account,
  authenticated: true,
  service: {
    displayName: profile.displayName,
    providerId: profile.providerId,
  },
});

const cookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

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
    return apiSuccess(memberSession(account, profile));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const response = apiSuccess(anonymousSession);
      response.cookies.set(CONNECTION_COOKIE, "", {
        ...cookieOptions,
        maxAge: 0,
      });
      return response;
    }
    return apiFailure(error, "Unable to read the member session.");
  }
};

export const POST = async (request: Request) => {
  try {
    assertSameOrigin(request);
    assertRequestRateLimit(
      request,
      "member-login",
      2_000,
      100,
      15 * 60 * 1000,
    );
    const credentials = memberCredentialsSchema.parse(
      await readJsonBody(request, MAX_MEMBER_LOGIN_BODY_BYTES),
    );
    assertSubjectRateLimit(
      "member-login",
      credentials.email.toLowerCase(),
      10,
      15 * 60 * 1000,
    );
    const profile = await activeProfile();
    const profileRevision = mailServiceProfileRevision(profile);
    if (!profile.allowedDomains.includes(emailDomain(credentials.email))) {
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
      return apiSuccess(
        { authenticated: false, mfaRequired: true },
        { status: 202 },
      );
    }
    if (authentication.status === "rejected") {
      throw new ApiError(
        "Incorrect email address, password or verification code.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    if (await memberTwoFactorSecurity.isEnabled(credentials.email)) {
      if (!credentials.otpCode) {
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
      throw new ApiError(
        "Incorrect email address or password.",
        "INVALID_MEMBER_CREDENTIALS",
        401,
      );
    }
    const previous = await getCurrentConnection().catch(() => null);
    const connection = connectionStore.create(
      {
        config,
        displayName: profile.displayName,
        providerId: profile.providerId,
      },
      profileRevision,
    );
    if (previous) {
      connectionStore.remove(previous.id);
    }
    const response = apiSuccess(memberSession(account, profile), {
      status: 201,
    });
    response.cookies.set(CONNECTION_COOKIE, connection.id, {
      ...cookieOptions,
      maxAge: MEMBER_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to sign in to this mailbox.");
  }
};

export const DELETE = async (request: Request) => {
  try {
    assertSameOrigin(request);
    const connection = await getCurrentConnection().catch(() => null);
    if (connection) {
      twoFactorEnrollmentStore.remove(connection.id);
      connectionStore.remove(connection.id);
    }
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(CONNECTION_COOKIE, "", {
      ...cookieOptions,
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return apiFailure(error, "Unable to sign out.");
  }
};
