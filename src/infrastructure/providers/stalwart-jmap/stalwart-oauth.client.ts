import "server-only";

import { z } from "zod";

import type {
  MemberAuthenticationResult,
  MemberCredentials,
} from "@/domain/provider/provider";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const REQUEST_TIMEOUT_MS = 20_000;
const CLIENT_ID = "webadmin";
const REDIRECT_URI = "stalwart://auth";

const loginResponseSchema = z.discriminatedUnion("type", [
  z.object({
    clientCode: z.string().min(1),
    iss: z.string().url(),
    type: z.literal("authenticated"),
  }),
  z.object({ type: z.literal("mfaRequired") }),
  z.object({ type: z.literal("failure") }),
]);

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
    const response = await fetch(new URL("/api/auth", origin), {
      body: JSON.stringify({
        accountName: credentials.email,
        accountSecret: credentials.password,
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
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
    const tokens = await this.exchange(origin, parsed.data.clientCode);
    return {
      config: {
        authType: "bearer",
        baseUrl: origin,
        expiresAt: tokens.expiresAt,
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
  ): Promise<StalwartOAuthTokens> {
    const origin = (await assertSafeProviderOrigin(baseUrl)).origin;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return this.requestTokens(origin, body, refreshToken);
  }

  private static exchange(origin: string, code: string) {
    return this.requestTokens(
      origin,
      new URLSearchParams({
        client_id: CLIENT_ID,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    );
  }

  private static async requestTokens(
    origin: string,
    body: URLSearchParams,
    currentRefreshToken?: string,
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
      expiresAt: expiresAt(parsed.data.expires_in),
      refreshToken: nextRefreshToken,
    };
  }
}
