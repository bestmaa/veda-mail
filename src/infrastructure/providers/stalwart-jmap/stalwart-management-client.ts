import "server-only";

import type { ZodType } from "zod";

import {
  fetchSameOriginJmap,
  readJmapResponseJson,
  sameOriginJmapUrl,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-http";
import {
  stalwartManagementResponseSchema,
  stalwartManagementSessionSchema,
  stalwartMethodErrorSchema,
  type StalwartManagementResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-management-schema";
import {
  JMAP_CORE,
  STALWART_JMAP,
  type JmapMethodCall,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_MANAGEMENT_RESPONSE_BYTES = 1_024 * 1_024;

export type StalwartManagementRequestErrorCode =
  | "auth"
  | "configuration"
  | "invalid-response"
  | "method-rejected"
  | "unavailable";

export class StalwartManagementRequestError extends Error {
  public readonly status: number | undefined;

  public constructor(
    public readonly code: StalwartManagementRequestErrorCode,
    public readonly ambiguousMutation: boolean,
    status?: number,
  ) {
    super("The mail provider management request failed.");
    this.name = "StalwartManagementRequestError";
    this.status = status;
  }
}

export interface StalwartManagementClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly expectedOrigin: string;
}

interface ManagementSession {
  readonly apiUrl: URL;
}

export class StalwartManagementClient {
  private sessionPromise: Promise<ManagementSession> | null = null;

  public constructor(private readonly config: StalwartManagementClientConfig) {
    if (
      config.apiKey.length < 1 ||
      config.apiKey.length > 4_096 ||
      config.apiKey.trim() !== config.apiKey
    ) {
      throw new StalwartManagementRequestError("configuration", false);
    }
  }

  public async request(
    methodCalls: readonly JmapMethodCall[],
    mutation = false,
  ): Promise<StalwartManagementResponse> {
    let issued = false;
    try {
      const session = await this.getSession();
      const body = JSON.stringify({
        methodCalls,
        using: [JMAP_CORE, STALWART_JMAP],
      });
      issued = true;
      const response = await fetch(session.apiUrl, {
        body,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const ambiguous =
          mutation && (response.status === 408 || response.status >= 500);
        throw new StalwartManagementRequestError(
          response.status === 401 || response.status === 403
            ? "auth"
            : "unavailable",
          ambiguous,
          response.status,
        );
      }
      const parsed = stalwartManagementResponseSchema.safeParse(
        await readJmapResponseJson(response, MAX_MANAGEMENT_RESPONSE_BYTES),
      );
      if (!parsed.success) {
        throw new StalwartManagementRequestError(
          "invalid-response",
          mutation,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof StalwartManagementRequestError) throw error;
      throw new StalwartManagementRequestError(
        "unavailable",
        mutation && issued,
      );
    }
  }

  public result<T>(
    response: StalwartManagementResponse,
    callId: string,
    expectedMethod: string,
    schema: ZodType<T>,
    mutation = false,
  ): T {
    const matching = response.methodResponses.filter(
      ([, , responseCallId]) => responseCallId === callId,
    );
    if (matching.length !== 1) {
      throw new StalwartManagementRequestError("invalid-response", mutation);
    }
    const [method, payload] = matching[0] ?? [];
    if (method === "error") {
      const parsedError = stalwartMethodErrorSchema.safeParse(payload);
      if (!parsedError.success) {
        throw new StalwartManagementRequestError("invalid-response", mutation);
      }
      throw new StalwartManagementRequestError(
        "method-rejected",
        mutation && parsedError.data.type === "serverPartialFail",
      );
    }
    if (method !== expectedMethod) {
      throw new StalwartManagementRequestError("invalid-response", mutation);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new StalwartManagementRequestError("invalid-response", mutation);
    }
    return parsed.data;
  }

  private async getSession(): Promise<ManagementSession> {
    this.sessionPromise ??= this.discover().catch((error: unknown) => {
      this.sessionPromise = null;
      throw error;
    });
    return this.sessionPromise;
  }

  private async discover(): Promise<ManagementSession> {
    let safeBase: URL;
    let expectedOrigin: string;
    try {
      const configured = new URL(this.config.expectedOrigin);
      const base = new URL(this.config.baseUrl);
      if (
        configured.protocol !== "https:" ||
        configured.username ||
        configured.password ||
        configured.search ||
        configured.hash ||
        (configured.pathname !== "/" && configured.pathname !== "") ||
        configured.origin !== base.origin
      ) {
        throw new Error("The management credential origin does not match.");
      }
      expectedOrigin = configured.origin;
      safeBase = await assertSafeProviderOrigin(this.config.baseUrl);
      if (safeBase.origin !== expectedOrigin) {
        throw new Error("The validated provider origin does not match.");
      }
    } catch {
      throw new StalwartManagementRequestError("configuration", false);
    }
    const response = await fetchSameOriginJmap(
      new URL("/.well-known/jmap", safeBase.origin),
      safeBase.origin,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new StalwartManagementRequestError(
        response.status === 401 || response.status === 403
          ? "auth"
          : "unavailable",
        false,
        response.status,
      );
    }
    const parsed = stalwartManagementSessionSchema.safeParse(
      await readJmapResponseJson(response, MAX_MANAGEMENT_RESPONSE_BYTES),
    );
    if (!parsed.success) {
      throw new StalwartManagementRequestError("invalid-response", false);
    }
    return {
      apiUrl: sameOriginJmapUrl(parsed.data.apiUrl, safeBase.origin),
    };
  }
}
