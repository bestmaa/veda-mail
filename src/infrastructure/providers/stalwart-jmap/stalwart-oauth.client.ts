import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import type {
  MemberAuthenticationResult,
  MemberCredentials,
} from "@/domain/provider/provider";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const REQUEST_TIMEOUT_MS = 20_000;
const REDIRECT_URI = "com.vedaconcepts.vedamail:/oauth/callback";
const OAUTH_SCOPE =
  "openid offline_access urn:ietf:params:oauth:scope:mail";

const loginResponseSchema = z.discriminatedUnion("type", [
  z.object({
    clientCode: z.string().min(1).optional(),
    client_code: z.string().min(1).optional(),
    iss: z.string().url(),
    type: z.literal("authenticated"),
  }),
  z.object({ type: z.literal("mfaRequired") }),
  z.object({ type: z.literal("failure") }),
]);

const registrationResponseSchema = z
  .object({ client_id: z.string().min(1) })
  .passthrough();

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1).optional(),
    token_type: z.string().min(1),
  })
  .passthrough();

export interface StalwartOAuthTokens {
  readonly accessToken: string;
  readonly clientId: string;
  readonly expiresAt: string;
  readonly refreshToken: string;
}

const responseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new Error("Stalwart returned an invalid OAuth response.");
  }
};

const expiresAt = (expiresIn: number): string =>
  new Date(Date.now() + expiresIn * 1_000).toISOString();

export class StalwartOAuthClient {
  public static async authenticate(
    serviceConfig: Readonly<Record<string, string>>,
    credentials: MemberCredentials,
  ): Promise<MemberAuthenticationResult> {
    const origin = (
      await assertSafeProviderOrigin(String(serviceConfig["baseUrl"] ?? ""))
    ).origin;
    const clientId = await this.register(origin);
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const response = await fetch(new URL("/api/auth", origin), {
      body: JSON.stringify({
        accountName: credentials.email,
        accountSecret: credentials.password,
        clientId,
        codeChallenge,
        codeChallengeMethod: "S256",
        redirectUri: REDIRECT_URI,
        scope: OAUTH_SCOPE,
        type: "authCode",
        ...(credentials.otpCode ? { mfaToken: credentials.otpCode } : {}),
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: "rejected" };
    }
    const parsed = loginResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success || parsed.data.type === "failure") {
      return { status: "rejected" };
    }
    if (parsed.data.type === "mfaRequired") {
      return { status: "mfa-required" };
    }
    if (new URL(parsed.data.iss).origin !== origin) {
      throw new Error("Stalwart returned a cross-origin OAuth issuer.");
    }
    const authorizationCode =
      parsed.data.clientCode ?? parsed.data.client_code ?? "";
    if (!authorizationCode) {
      throw new Error("Stalwart did not return an OAuth authorization code.");
    }
    const tokens = await this.exchange(
      origin,
      clientId,
      authorizationCode,
      codeVerifier,
    );
    return {
      config: {
        authType: "bearer",
        baseUrl: origin,
        expiresAt: tokens.expiresAt,
        oauthClientId: tokens.clientId,
        refreshToken: tokens.refreshToken,
        secret: tokens.accessToken,
        username: credentials.email,
      },
      status: "authenticated",
    };
  }

  public static async refresh(
    baseUrl: string,
    refreshToken: string,
    clientId?: string,
  ): Promise<StalwartOAuthTokens> {
    const origin = (await assertSafeProviderOrigin(baseUrl)).origin;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...(clientId ? { client_id: clientId } : {}),
    });
    return this.requestTokens(origin, body, refreshToken, clientId);
  }

  private static exchange(
    origin: string,
    clientId: string,
    code: string,
    codeVerifier: string,
  ) {
    return this.requestTokens(
      origin,
      new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
      undefined,
      clientId,
    );
  }

  private static async register(origin: string): Promise<string> {
    const response = await fetch(new URL("/auth/register", origin), {
      body: JSON.stringify({
        client_name: "Veda Mail",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: [REDIRECT_URI],
        response_types: ["code"],
        scope: OAUTH_SCOPE,
        token_endpoint_auth_method: "none",
      }),
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("Stalwart OAuth client registration failed.");
    }
    const parsed = registrationResponseSchema.safeParse(
      await responseJson(response),
    );
    if (!parsed.success) {
      throw new Error("Stalwart returned an invalid OAuth registration.");
    }
    return parsed.data.client_id;
  }

  private static async requestTokens(
    origin: string,
    body: URLSearchParams,
    currentRefreshToken?: string,
    clientId?: string,
  ): Promise<StalwartOAuthTokens> {
    const response = await fetch(new URL("/auth/token", origin), {
      body,
      cache: "no-store",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error("Stalwart OAuth token request failed.");
    }
    const parsed = tokenResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw new Error("Stalwart returned invalid OAuth tokens.");
    }
    const nextRefreshToken =
      parsed.data.refresh_token ?? currentRefreshToken ?? "";
    if (!nextRefreshToken) {
      throw new Error("Stalwart did not return an OAuth refresh token.");
    }
    return {
      accessToken: parsed.data.access_token,
      clientId: clientId ?? "",
      expiresAt: expiresAt(parsed.data.expires_in),
      refreshToken: nextRefreshToken,
    };
  }
}
