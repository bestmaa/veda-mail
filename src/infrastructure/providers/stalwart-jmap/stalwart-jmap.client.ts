import "server-only";

import type { ZodType } from "zod";

import type { OutgoingAttachment } from "@/domain/mail/mail";
import {
  jmapResponseSchema,
  jmapSessionSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { StalwartOAuthClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-oauth.client";
import type { JmapProviderUploadReference } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import { uploadJmapOutgoingAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import {
  JMAP_CORE,
  type JmapMethodCall,
  type JmapResponse,
  type JmapSession,
  type StalwartConfig,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const REQUEST_TIMEOUT_MS = 20_000;
const invalidResponse = (subject: string): Error =>
  new Error(`Mail provider returned invalid ${subject}.`);

const responseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw invalidResponse("JSON");
  }
};

const basicAuthorizationHeader = (config: StalwartConfig): string => {
  const encoded = Buffer.from(`${config.username}:${config.secret}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
};

const sameOriginUrl = (value: string, expectedOrigin: string): URL => {
  const parsed = new URL(value, expectedOrigin);
  if (
    parsed.origin !== expectedOrigin ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error("Mail provider returned a cross-origin JMAP endpoint.");
  }
  return parsed;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const fetchSameOrigin = async (
  initialUrl: URL,
  expectedOrigin: string,
  init: RequestInit,
): Promise<Response> => {
  let requestUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetch(requestUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location || redirectCount === 3) {
      throw new Error("Mail provider returned an invalid redirect.");
    }
    requestUrl = sameOriginUrl(location, expectedOrigin);
  }
  throw new Error("Mail provider returned too many redirects.");
};

export class StalwartJmapClient {
  private accessToken: string | null;
  private accessTokenExpiresAt: number | null;
  private refreshPromise: Promise<void> | null = null;
  private refreshToken: string | null;
  private sessionPromise: Promise<JmapSession> | null = null;

  public constructor(private readonly config: StalwartConfig) {
    this.accessToken = config.authType === "bearer" ? config.secret : null;
    this.accessTokenExpiresAt =
      config.authType === "bearer" && config.expiresAt
        ? Date.parse(config.expiresAt)
        : null;
    this.refreshToken =
      config.authType === "bearer" ? (config.refreshToken ?? null) : null;
  }

  public getSession(): Promise<JmapSession> {
    this.sessionPromise ??= this.discover().catch((error: unknown) => {
      this.sessionPromise = null;
      throw error;
    });
    return this.sessionPromise;
  }

  public async request(
    methodCalls: readonly JmapMethodCall[],
    using: readonly string[],
  ): Promise<JmapResponse> {
    const session = await this.getSession();
    const authHeader = await this.authorizationHeader();
    const origin = (await assertSafeProviderOrigin(this.config.baseUrl)).origin;
    const apiUrl = sameOriginUrl(session.apiUrl, origin);
    const response = await fetch(apiUrl, {
      body: JSON.stringify({ methodCalls, using: [JMAP_CORE, ...using] }),
      cache: "no-store",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw await this.toHttpError(response);
    }
    const parsed = jmapResponseSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw invalidResponse("JMAP response");
    }
    return parsed.data;
  }

  public async uploadAttachment(
    accountId: string,
    attachment: OutgoingAttachment,
  ): Promise<JmapProviderUploadReference> {
    const session = await this.getSession();
    return uploadJmapOutgoingAttachment({
      accountId,
      attachment,
      authorizationHeader: () => this.authorizationHeader(),
      baseUrl: this.config.baseUrl,
      session,
    });
  }

  public result<T>(
    response: JmapResponse,
    callId: string,
    expectedMethod: string,
    schema: ZodType<T>,
  ): T {
    const methodResponse = response.methodResponses.find(
      ([, , responseCallId]) => responseCallId === callId,
    );
    if (!methodResponse) {
      throw new Error(`JMAP response ${callId} was missing.`);
    }
    const [method, payload] = methodResponse;
    if (method === "error") {
      const description =
        typeof payload === "object" && payload && "description" in payload
          ? String(payload.description)
          : "JMAP request failed.";
      throw new Error(description);
    }
    if (method !== expectedMethod) {
      throw new Error(`Unexpected JMAP method response: ${method}.`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw invalidResponse(`${expectedMethod} payload`);
    }
    return parsed.data;
  }

  private async discover(): Promise<JmapSession> {
    const origin = (await assertSafeProviderOrigin(this.config.baseUrl)).origin;
    const discoveryUrl = new URL("/.well-known/jmap", origin);
    const authHeader = await this.authorizationHeader(false);
    const response = await fetchSameOrigin(discoveryUrl, origin, {
      cache: "no-store",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw await this.toHttpError(response);
    }
    const parsed = jmapSessionSchema.safeParse(await responseJson(response));
    if (!parsed.success) {
      throw invalidResponse("JMAP session");
    }
    const session: JmapSession = parsed.data;
    sameOriginUrl(session.apiUrl, origin);
    sameOriginUrl(session.uploadUrl, origin);
    sameOriginUrl(session.downloadUrl, origin);
    return session;
  }

  private async authorizationHeader(invalidateSession = true): Promise<string> {
    if (this.config.authType === "basic") {
      return basicAuthorizationHeader(this.config);
    }
    const refreshBefore = Date.now() + 30_000;
    if (
      this.accessTokenExpiresAt !== null &&
      this.accessTokenExpiresAt <= refreshBefore
    ) {
      await this.refreshAccessToken(invalidateSession);
    }
    if (!this.accessToken) {
      throw new Error("The Stalwart OAuth access token is missing.");
    }
    return `Bearer ${this.accessToken}`;
  }

  private async refreshAccessToken(invalidateSession: boolean): Promise<void> {
    if (!this.refreshToken) {
      throw new Error("The Stalwart OAuth refresh token is missing.");
    }
    this.refreshPromise ??= StalwartOAuthClient.refresh(
      this.config.baseUrl,
      this.refreshToken,
      this.config.oauthClientId,
    )
      .then((tokens) => {
        this.accessToken = tokens.accessToken;
        this.accessTokenExpiresAt = Date.parse(tokens.expiresAt);
        this.refreshToken = tokens.refreshToken;
        if (invalidateSession) {
          this.sessionPromise = null;
        }
      })
      .finally(() => {
        this.refreshPromise = null;
      });
    await this.refreshPromise;
  }

  private async toHttpError(response: Response): Promise<Error> {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    return new Error(
      `Mail provider returned ${response.status}.${suffix}`.trim(),
    );
  }
}
