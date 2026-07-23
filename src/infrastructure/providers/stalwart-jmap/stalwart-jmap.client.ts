import "server-only";

import type { ZodType } from "zod";

import {
  jmapResponseSchema,
  jmapSessionSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
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

const authorizationHeader = (config: StalwartConfig): string => {
  if (config.authType === "bearer") {
    return `Bearer ${config.secret}`;
  }
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
  private readonly authHeader: string;
  private sessionPromise: Promise<JmapSession> | null = null;

  public constructor(private readonly config: StalwartConfig) {
    this.authHeader = authorizationHeader(config);
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
    const origin = (await assertSafeProviderOrigin(this.config.baseUrl)).origin;
    const apiUrl = sameOriginUrl(session.apiUrl, origin);
    const response = await fetch(apiUrl, {
      body: JSON.stringify({ methodCalls, using: [JMAP_CORE, ...using] }),
      cache: "no-store",
      headers: {
        Authorization: this.authHeader,
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
    const response = await fetchSameOrigin(discoveryUrl, origin, {
      cache: "no-store",
      headers: { Authorization: this.authHeader },
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

  private async toHttpError(response: Response): Promise<Error> {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    return new Error(`Mail provider returned ${response.status}.${suffix}`.trim());
  }
}
