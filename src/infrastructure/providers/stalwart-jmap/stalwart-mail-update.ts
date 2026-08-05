import "server-only";

import type { MailUpdateMode, MailUpdateWaitResult } from "@/domain/mail/mail-update";
import {
  jmapEventSourceUrl,
  readJmapStateEvent,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-event-source";
import { stalwartHttpError } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-client-helpers";
import { sameOriginJmapUrl } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-http";
import type { JmapSession } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";
import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";

const EVENT_WAIT_TIMEOUT_MS = 55_000;

interface JmapUpdateClient {
  authorizationForProviderTransport(): Promise<string>;
  getSession(): Promise<JmapSession>;
}

const eventUrl = async (
  client: JmapUpdateClient,
  baseUrl: string,
): Promise<URL | null> => {
  const session = await client.getSession();
  if (!session.eventSourceUrl) return null;
  const origin = (await assertSafeProviderOrigin(baseUrl)).origin;
  try {
    return sameOriginJmapUrl(jmapEventSourceUrl(session.eventSourceUrl), origin);
  } catch {
    return null;
  }
};

export const getStalwartMailUpdateMode = async (
  client: JmapUpdateClient,
  baseUrl: string,
): Promise<MailUpdateMode> => await eventUrl(client, baseUrl) ? "push" : "poll";

export const waitForStalwartMailUpdate = async (
  client: JmapUpdateClient,
  baseUrl: string,
): Promise<MailUpdateWaitResult> => {
  const url = await eventUrl(client, baseUrl);
  if (!url) {
    return { mode: "poll", retryAfterMs: 60_000, shouldRefresh: true };
  }
  const signal = AbortSignal.timeout(EVENT_WAIT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "text/event-stream",
        Authorization: await client.authorizationForProviderTransport(),
      },
      redirect: "error",
      signal,
    });
    if (!response.ok) throw stalwartHttpError(response);
    if (!response.headers.get("content-type")?.toLowerCase()
      .startsWith("text/event-stream")) {
      throw new Error("The JMAP event source returned an invalid content type.");
    }
    if (!response.body) throw new Error("The JMAP event stream was empty.");
    const changed = await readJmapStateEvent(response.body);
    return { mode: "push", retryAfterMs: 1_000, shouldRefresh: changed };
  } catch (error) {
    if (signal.aborted) {
      return { mode: "push", retryAfterMs: 1_000, shouldRefresh: false };
    }
    throw error;
  }
};
