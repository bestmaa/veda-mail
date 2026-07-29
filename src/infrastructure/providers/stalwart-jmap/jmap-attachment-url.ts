import "server-only";

import { assertSafeProviderOrigin } from "@/infrastructure/providers/stalwart-jmap/provider-url-policy";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";

type EndpointKind = "download" | "upload";
type TemplateVariable = "accountId" | "blobId" | "name" | "type";

const requiredVariables: Readonly<
  Record<EndpointKind, readonly TemplateVariable[]>
> = {
  download: ["accountId", "blobId", "name", "type"],
  upload: ["accountId"],
};
const allowedVariables = new Set<TemplateVariable>([
  "accountId",
  "blobId",
  "name",
  "type",
]);
const sensitiveQueryKeys = new Set([
  "access_token",
  "apikey",
  "api_key",
  "authorization",
  "key",
  "password",
  "secret",
  "token",
]);
const tokenPattern = /\{([^{}]+)\}/g;
const hasAsciiControl = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const rejected = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "endpoint_rejected",
    "The mail provider attachment endpoint is not permitted.",
  );

const decodeRepeatedly = (value: string): string => {
  let decoded = value;
  for (let count = 0; count <= value.length; count += 1) {
    const next = decoded.replace(
      /%(?:25|2e|2f|5c)/giu,
      (match) =>
        ({ "%25": "%", "%2e": ".", "%2f": "/", "%5c": "\\" })[
          match.toLowerCase()
        ] ?? match,
    );
    if (next === decoded) return decoded;
    decoded = next;
  }
  throw rejected();
};

const assertNoPathTraversal = (rawTemplate: string): void => {
  const rawPath = rawTemplate.split(/[?#]/u)[0] ?? "";
  for (const segment of rawPath.split("/")) {
    const decoded = decodeRepeatedly(segment);
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("\\") ||
      (decoded.includes("/") && !segment.includes("/"))
    ) {
      throw rejected();
    }
  }
};

const assertSafeValue = (name: TemplateVariable, value: string): void => {
  if (value.length === 0 || value.length > 255 || hasAsciiControl(value)) {
    throw rejected();
  }
  if (name === "type") {
    if (!/^[^\s/;]+\/[^\s/;]+$/u.test(value)) throw rejected();
    return;
  }
  if (name === "name") {
    if (
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\")
    ) {
      throw rejected();
    }
    return;
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw rejected();
  }
};

const encodeTemplateValue = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const templateTokens = (
  template: string,
  kind: EndpointKind,
): readonly TemplateVariable[] => {
  const tokens = [...template.matchAll(tokenPattern)].map((match) => match[1]);
  if (
    /%7b|%7d/iu.test(template) ||
    template.replace(tokenPattern, "").match(/[{}]/u) ||
    tokens.some((token) => !allowedVariables.has(token as TemplateVariable))
  ) {
    throw rejected();
  }
  const typedTokens = tokens as TemplateVariable[];
  for (const required of requiredVariables[kind]) {
    if (typedTokens.filter((token) => token === required).length !== 1) {
      throw rejected();
    }
  }
  if (
    typedTokens.some((token, index) => typedTokens.indexOf(token) !== index) ||
    (kind === "upload" && typedTokens.some((token) => token !== "accountId"))
  ) {
    throw rejected();
  }
  return typedTokens;
};

const safeOrigin = async (baseUrl: string): Promise<string> => {
  try {
    return (await assertSafeProviderOrigin(baseUrl)).origin;
  } catch {
    throw rejected();
  }
};

export const resolveJmapAttachmentUrl = async (
  baseUrl: string,
  template: string,
  kind: EndpointKind,
  values: Readonly<Partial<Record<TemplateVariable, string>>>,
): Promise<URL> => {
  if (
    template.length === 0 ||
    template.length > 4_096 ||
    hasAsciiControl(template) ||
    template.includes("\\")
  ) {
    throw rejected();
  }
  const tokens = templateTokens(template, kind);
  assertNoPathTraversal(template);
  const origin = await safeOrigin(baseUrl);
  const markers = new Map(
    tokens.map((token, index) => [token, `vedatemplatemarker${index}`]),
  );
  const marked = template.replace(
    tokenPattern,
    (_, token: TemplateVariable) => markers.get(token) ?? "",
  );

  let markedUrl: URL;
  try {
    markedUrl = new URL(marked, origin);
  } catch {
    throw rejected();
  }
  if (
    markedUrl.origin !== origin ||
    markedUrl.username ||
    markedUrl.password ||
    markedUrl.hash
  ) {
    throw rejected();
  }
  for (const marker of markers.values()) {
    if (
      !(
        markedUrl.pathname.includes(marker) || markedUrl.search.includes(marker)
      ) ||
      [...markedUrl.searchParams.keys()].some((key) => key.includes(marker))
    ) {
      throw rejected();
    }
  }
  if (
    [...markedUrl.searchParams.keys()].some((key) =>
      sensitiveQueryKeys.has(key.toLowerCase()),
    )
  ) {
    throw rejected();
  }

  let substituted: string;
  try {
    substituted = template.replace(tokenPattern, (_, rawToken: string) => {
      const token = rawToken as TemplateVariable;
      const value = values[token];
      if (value === undefined) throw rejected();
      assertSafeValue(token, value);
      return encodeTemplateValue(value);
    });
  } catch (error) {
    if (error instanceof JmapAttachmentTransportError) throw error;
    throw rejected();
  }
  let endpoint: URL;
  try {
    endpoint = new URL(substituted, origin);
  } catch {
    throw rejected();
  }
  if (endpoint.origin !== origin || endpoint.username || endpoint.password) {
    throw rejected();
  }
  return endpoint;
};
