import "server-only";

import type {
  JmapMethodResponse,
  JmapResponse,
  StalwartConfig,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface StalwartJmapRequestBoundary {
  issued: boolean;
}

export type StalwartJmapMethodErrorKind =
  | "definitive"
  | "malformed"
  | "server-partial-fail";

const DEFINITIVE_JMAP_HTTP_REJECTIONS = new Set([
  400, 401, 403, 404, 405, 409, 413, 415, 422, 429,
]);

export class StalwartJmapHttpError extends Error {
  public readonly methodsWereNotExecuted: boolean;
  public readonly status: number;

  public constructor(status: number) {
    super(`Mail provider returned HTTP status ${status}.`);
    this.name = "StalwartJmapHttpError";
    this.methodsWereNotExecuted =
      DEFINITIVE_JMAP_HTTP_REJECTIONS.has(status);
    this.status = status;
  }
}

const methodErrorType = (payload: unknown): string | null => {
  try {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("type" in payload) ||
      typeof payload.type !== "string" ||
      payload.type.length === 0 ||
      payload.type.length > 128 ||
      payload.type.trim() !== payload.type
    ) {
      return null;
    }
    return payload.type;
  } catch {
    return null;
  }
};

export class StalwartJmapMethodError extends Error {
  public readonly kind: StalwartJmapMethodErrorKind;

  public constructor(payload: unknown) {
    super("The JMAP provider rejected the request.");
    this.name = "StalwartJmapMethodError";
    const type = methodErrorType(payload);
    this.kind =
      type === null
        ? "malformed"
        : type === "serverPartialFail"
          ? "server-partial-fail"
          : "definitive";
  }
}

export const uniqueJmapMethodResponse = (
  response: JmapResponse,
  callId: string,
  expectedMethod: string,
  allowedImplicitMethods: readonly string[],
): JmapMethodResponse => {
  const matching = response.methodResponses.filter(
    ([, , responseCallId]) => responseCallId === callId,
  );
  const primary = matching.filter(
    ([method]) => method === expectedMethod || method === "error",
  );
  const selected = primary.length === 1 ? primary[0] : undefined;
  if (!selected) throw new Error("JMAP response was missing or ambiguous.");
  const implicit = matching.filter((candidate) => candidate !== selected);
  const implicitMethods = implicit.map(([method]) => method);
  const allowed =
    selected[0] !== "error" &&
    implicitMethods.every((method) => allowedImplicitMethods.includes(method)) &&
    new Set(implicitMethods).size === implicitMethods.length;
  if (implicit.length > 0 && !allowed) {
    throw new Error("JMAP response was missing or ambiguous.");
  }
  return selected;
};

export const basicAuthorizationHeader = (config: StalwartConfig): string => {
  const encoded = Buffer.from(`${config.username}:${config.secret}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
};

export const stalwartHttpError = (
  response: Response,
): StalwartJmapHttpError => {
  void response.body?.cancel().catch(() => undefined);
  return new StalwartJmapHttpError(response.status);
};
