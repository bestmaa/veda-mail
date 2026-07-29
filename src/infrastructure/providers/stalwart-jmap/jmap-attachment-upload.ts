import "server-only";

import {
  createJmapAttachmentHandle,
  createJmapAttachmentId,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-handle";
import {
  assertJmapAttachmentMetadata,
  assertJmapText,
  jmapAuthorization,
  requestJmapAttachment,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-request";
import { readJmapResponseBytes } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-response";
import {
  prepareJmapUploadBody,
  throwIfAttachmentAborted,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-stream";
import type {
  JmapAttachmentHandle,
  JmapAttachmentTransportConfig,
  JmapUploadAttachmentInput,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { JmapAttachmentTransportError } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";
import { resolveJmapAttachmentUrl } from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-url";

const MAX_UPLOAD_RESPONSE_BYTES = 64 * 1_024;
const invalidUploadResponse = (): JmapAttachmentTransportError =>
  new JmapAttachmentTransportError(
    "invalid_provider_response",
    "Mail provider returned an invalid attachment response.",
  );

const uploadPayload = (bytes: Uint8Array): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (typeof value !== "object" || value === null) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw invalidUploadResponse();
  }
};

export const uploadJmapAttachment = async (
  config: JmapAttachmentTransportConfig,
  input: JmapUploadAttachmentInput,
  owner: object,
): Promise<JmapAttachmentHandle> => {
  assertJmapText(input.accountId, 1_024);
  assertJmapAttachmentMetadata(
    input.fileName,
    input.mediaType,
    input.contentLength,
  );
  if (input.contentLength > config.maxUploadBytes) {
    throw new JmapAttachmentTransportError(
      "size_limit_exceeded",
      "The attachment exceeds the configured size limit.",
    );
  }
  throwIfAttachmentAborted(input.signal);
  const endpoint = await resolveJmapAttachmentUrl(
    config.baseUrl,
    config.uploadUrl,
    "upload",
    { accountId: input.accountId },
  );
  const authorization = await jmapAuthorization(config, input.signal);
  const body = prepareJmapUploadBody(
    input.body,
    input.contentLength,
    input.signal,
  );
  const response = await requestJmapAttachment(
    endpoint,
    {
      body,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        Authorization: authorization,
        "Content-Length": String(input.contentLength),
        "Content-Type": input.mediaType,
      },
      method: "POST",
      ...(input.body instanceof Uint8Array ? {} : { duplex: "half" as const }),
    },
    input.signal,
  );
  const bytes = await readJmapResponseBytes(response, {
    maxBytes: MAX_UPLOAD_RESPONSE_BYTES,
    requireContentLength: false,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const payload = uploadPayload(bytes);
  if (
    payload["accountId"] !== input.accountId ||
    typeof payload["blobId"] !== "string" ||
    typeof payload["type"] !== "string" ||
    payload["size"] !== input.contentLength
  ) {
    throw invalidUploadResponse();
  }
  try {
    assertJmapText(payload["blobId"], 1_024);
    assertJmapAttachmentMetadata(
      input.fileName,
      payload["type"],
      input.contentLength,
    );
  } catch {
    throw invalidUploadResponse();
  }
  if (payload["type"].toLowerCase() !== input.mediaType.toLowerCase()) {
    throw invalidUploadResponse();
  }
  return createJmapAttachmentHandle(
    {
      attachmentId: createJmapAttachmentId(payload["blobId"]),
      fileName: input.fileName,
      mediaType: input.mediaType,
      size: input.contentLength,
    },
    {
      accountId: input.accountId,
      blobId: payload["blobId"],
      kind: "upload",
      owner,
    },
  );
};
