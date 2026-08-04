import "server-only";

import type { ZodType } from "zod";

import type {
  AttachmentDownload,
  AttachmentDownloadInput,
  OutgoingAttachment,
} from "@/domain/mail/mail";
import {
  jmapResponseSchema,
  jmapSessionSchema,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.schema";
import { StalwartOAuthClient } from "@/infrastructure/providers/stalwart-jmap/stalwart-oauth.client";
import type { JmapProviderUploadReference } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport";
import { downloadJmapReceivedAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-incoming-attachment";
import { uploadJmapOutgoingAttachment } from "@/infrastructure/providers/stalwart-jmap/jmap-outgoing-attachment";
import type { JmapReceivedAttachment } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import {
  awaitProviderOperation,
  providerOperationSignal,
  rejectIfProviderOperationAborted,
} from "@/infrastructure/providers/provider-operation-signal";
import {
  basicAuthorizationHeader,
  StalwartJmapMethodError,
  stalwartHttpError,
  type StalwartJmapRequestBoundary,
  uniqueJmapMethodResponse,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import {
  fetchSameOriginJmap,
  invalidJmapResponse,
  readJmapResponseJson,
  sameOriginJmapUrl,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-http";
import {
  JMAP_CORE,
  type JmapMethodCall,
  type JmapResponse,
  type JmapSession,
  type StalwartConfig,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const REQUEST_TIMEOUT_MS = 20_000;

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

  public async getSession(signal?: AbortSignal): Promise<JmapSession> {
    const sessionSignal = providerOperationSignal(signal, REQUEST_TIMEOUT_MS);
    rejectIfProviderOperationAborted(sessionSignal);
    this.sessionPromise ??= this.discover().catch((error: unknown) => {
      this.sessionPromise = null;
      throw error;
    });
    return awaitProviderOperation(this.sessionPromise, sessionSignal);
  }

  public async request(
    methodCalls: readonly JmapMethodCall[],
    using: readonly string[],
    signal?: AbortSignal,
    boundary?: StalwartJmapRequestBoundary,
  ): Promise<JmapResponse> {
    const requestSignal = providerOperationSignal(signal, REQUEST_TIMEOUT_MS);
    rejectIfProviderOperationAborted(requestSignal);
    const session = await this.getSession(requestSignal);
    const authHeader = await awaitProviderOperation(
      this.authorizationHeader(),
      requestSignal,
    );
    const origin = (
      await awaitProviderOperation(
        assertSafeProviderOrigin(this.config.baseUrl),
        requestSignal,
      )
    ).origin;
    const apiUrl = sameOriginJmapUrl(session.apiUrl, origin);
    const body = JSON.stringify({ methodCalls, using: [JMAP_CORE, ...using] });
    rejectIfProviderOperationAborted(requestSignal);
    if (boundary) boundary.issued = true;
    const response = await fetch(apiUrl, {
      body,
      cache: "no-store",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: requestSignal,
    });

    if (!response.ok) {
      throw stalwartHttpError(response);
    }
    const parsed = jmapResponseSchema.safeParse(
      await readJmapResponseJson(response),
    );
    if (!parsed.success) {
      throw invalidJmapResponse("JMAP response");
    }
    return parsed.data;
  }
  public authorizationForProviderTransport() { return this.authorizationHeader(); }

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

  public async downloadAttachment(
    input: Pick<
      AttachmentDownloadInput,
      "maxBytes" | "messageId" | "signal"
    > & {
      readonly accountId: string;
      readonly attachment: JmapReceivedAttachment;
    },
  ): Promise<AttachmentDownload> {
    const session = await this.getSession(input.signal);
    return downloadJmapReceivedAttachment({
      accountId: input.accountId,
      attachment: input.attachment,
      authorizationHeader: () => this.authorizationHeader(),
      baseUrl: this.config.baseUrl,
      maxBytes: input.maxBytes,
      messageId: input.messageId,
      session,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  public result<T>(
    response: JmapResponse,
    callId: string,
    expectedMethod: string,
    schema: ZodType<T>,
    allowedImplicitMethods: readonly string[] = [],
  ): T {
    const [method, payload] = uniqueJmapMethodResponse(
      response,
      callId,
      expectedMethod,
      allowedImplicitMethods,
    );
    if (method === "error") {
      throw new StalwartJmapMethodError(payload);
    }
    if (method !== expectedMethod) {
      throw new Error("Mail provider returned an unexpected JMAP response.");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw invalidJmapResponse(`${expectedMethod} payload`);
    }
    return parsed.data;
  }

  private async discover(): Promise<JmapSession> {
    const origin = (await assertSafeProviderOrigin(this.config.baseUrl)).origin;
    const discoveryUrl = new URL("/.well-known/jmap", origin);
    const authHeader = await this.authorizationHeader(false);
    const response = await fetchSameOriginJmap(discoveryUrl, origin, {
      cache: "no-store",
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw stalwartHttpError(response);
    }
    const parsed = jmapSessionSchema.safeParse(
      await readJmapResponseJson(response),
    );
    if (!parsed.success) {
      throw invalidJmapResponse("JMAP session");
    }
    const session: JmapSession = parsed.data;
    sameOriginJmapUrl(session.apiUrl, origin);
    sameOriginJmapUrl(session.uploadUrl, origin);
    sameOriginJmapUrl(session.downloadUrl, origin);
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
}
