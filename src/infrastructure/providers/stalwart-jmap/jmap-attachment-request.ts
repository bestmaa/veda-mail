import "server-only";

import { throwIfAttachmentAborted } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-stream";
import type { JmapAttachmentTransportConfig } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const hasAsciiControl = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

export const invalidAttachmentInput = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "invalid_input",
    "Attachment metadata was invalid.",
  );

export const assertJmapByteLimit = (value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw invalidAttachmentInput();
  }
};

export function assertJmapText(
  value: unknown,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    hasAsciiControl(value)
  ) {
    throw invalidAttachmentInput();
  }
}

export const assertJmapAttachmentMetadata = (
  fileName: string,
  mediaType: string,
  size: number,
): void => {
  assertJmapText(fileName, 255);
  assertJmapText(mediaType, 255);
  if (
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    throw invalidAttachmentInput();
  }
  if (!/^[^\s/;]+\/[^\s/;]+$/u.test(mediaType)) {
    throw invalidAttachmentInput();
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw invalidAttachmentInput();
  }
};

const transportErrorFrom = (
  error: unknown,
  signal?: AbortSignal,
): JmapAttachmentTransportError => {
  if (signal?.aborted) {
    return new JmapAttachmentTransportError(
      "aborted",
      "The attachment operation was cancelled.",
    );
  }
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (current instanceof JmapAttachmentTransportError) return current;
    if (current instanceof DOMException && current.name === "AbortError") {
      return new JmapAttachmentTransportError(
        "aborted",
        "The attachment operation was cancelled.",
      );
    }
    current =
      typeof current === "object" && current && "cause" in current
        ? current.cause
        : undefined;
  }
  return new JmapAttachmentTransportError(
    "network_error",
    "The mail provider attachment request failed.",
  );
};

export const jmapAuthorization = async (
  config: JmapAttachmentTransportConfig,
  signal?: AbortSignal,
): Promise<string> => {
  throwIfAttachmentAborted(signal);
  let value: unknown;
  try {
    value = await config.authorizationHeader();
  } catch {
    throw new JmapAttachmentTransportError(
      "authorization_failed",
      "Mail provider authorization was unavailable.",
    );
  }
  throwIfAttachmentAborted(signal);
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8_192 ||
    hasAsciiControl(value)
  ) {
    throw new JmapAttachmentTransportError(
      "authorization_failed",
      "Mail provider authorization was unavailable.",
    );
  }
  return value;
};

export const requestJmapAttachment = async (
  url: URL,
  init: RequestInit & { readonly duplex?: "half" },
  signal?: AbortSignal,
): Promise<Response> => {
  throwIfAttachmentAborted(signal);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    throw transportErrorFrom(error, signal);
  }
  if (
    REDIRECT_STATUSES.has(response.status) ||
    response.type === "opaqueredirect"
  ) {
    void response.body?.cancel().catch(() => undefined);
    throw new JmapAttachmentTransportError(
      "redirect_rejected",
      "Mail provider attachment redirects are not allowed.",
    );
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new JmapAttachmentTransportError(
      "provider_http_error",
      "Mail provider rejected the attachment request.",
      response.status,
    );
  }
  return response;
};
