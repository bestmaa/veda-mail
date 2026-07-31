import { vi } from "vitest";

import { STALWART_JMAP } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface RecordedManagementCall {
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly callId: string;
  readonly method: string;
}

export interface ManagementHandlerResult {
  readonly method?: string;
  readonly payload: unknown;
}

export type ManagementHandler = (
  call: RecordedManagementCall,
) => ManagementHandlerResult | Promise<ManagementHandlerResult>;

export const DOMAIN = {
  directoryId: null,
  id: "domain-1",
  isEnabled: true,
  name: "example.com",
};

export const USER = {
  "@type": "User",
  aliases: {
    "0": { domainId: "domain-1", enabled: true, name: "alias" },
    "1": { domainId: "other-domain", enabled: true, name: "private" },
  },
  createdAt: "2026-07-31T10:00:00.000Z",
  credentials: {
    "0": { "@type": "Password", secret: "provider-private-secret" },
  },
  description: "Alice",
  domainId: "domain-1",
  emailAddress: "alice@example.com",
  id: "user-1",
  locale: "en_US",
  name: "alice",
  quotas: { maxDiskQuota: 1_000_000 },
  permissions: { "@type": "Inherit" },
  roles: { "@type": "User" },
  timeZone: "Asia/Kolkata",
  usedDiskQuota: 50_000,
};

export const queryResult = (
  ids: readonly string[],
  total = ids.length,
  position = 0,
) => ({ ids, position, queryState: "query-state", total });

export const getResult = (list: readonly unknown[]) => ({
  list,
  notFound: [],
  state: "state",
});

export const installManagementFetch = (handler: ManagementHandler) => {
  const calls: RecordedManagementCall[] = [];
  const fetchMock = vi.fn(
    async (
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      if (!init?.body) {
        return Response.json({
          apiUrl: "https://mail.example.com/jmap/",
          capabilities: { [STALWART_JMAP]: {} },
        });
      }
      const envelope = JSON.parse(String(init.body)) as {
        readonly methodCalls: readonly [
          string,
          Readonly<Record<string, unknown>>,
          string,
        ][];
      };
      const methodCall = envelope.methodCalls[0];
      if (!methodCall) throw new Error("Missing management method call.");
      const call = {
        arguments: methodCall[1],
        callId: methodCall[2],
        method: methodCall[0],
      };
      calls.push(call);
      const result = await handler(call);
      return Response.json({
        methodResponses: [
          [result.method ?? call.method, result.payload, call.callId],
        ],
        sessionState: "session-state",
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
};

export const commonReadHandler = (
  call: RecordedManagementCall,
): ManagementHandlerResult | null => {
  if (call.method === "x:Domain/query") {
    return { payload: queryResult([DOMAIN.id]) };
  }
  if (call.method === "x:Domain/get") {
    return { payload: getResult([DOMAIN]) };
  }
  return null;
};
