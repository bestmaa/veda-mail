import "server-only";

import { randomUUID } from "node:crypto";

import type {
  JmapAttachmentHandle,
  JmapProviderUploadReference,
  JmapPublicAttachment,
} from "@/infrastructure/providers/stalwart-jmap/jmap-attachment-transport.types";

interface JmapAttachmentSecret {
  readonly accountId: string;
  readonly blobId: string;
  readonly kind: "message" | "upload";
  readonly messageId?: string;
  readonly owner: object;
}

const handleSecrets = new WeakMap<JmapAttachmentHandle, JmapAttachmentSecret>();

export const createJmapAttachmentId = (providerBlobId: string): string => {
  const candidate = `attachment_${randomUUID()}`;
  return candidate === providerBlobId ? `_${candidate}` : candidate;
};

export const createJmapAttachmentHandle = (
  metadata: JmapPublicAttachment,
  secret: JmapAttachmentSecret,
): JmapAttachmentHandle => {
  const publicMetadata = Object.freeze({ ...metadata });
  const handle: JmapAttachmentHandle = Object.freeze({
    ...publicMetadata,
    toJSON: (): JmapPublicAttachment => publicMetadata,
  });
  handleSecrets.set(handle, Object.freeze({ ...secret }));
  return handle;
};

export const readJmapAttachmentSecret = (
  handle: JmapAttachmentHandle,
  owner: object,
): JmapAttachmentSecret | undefined => {
  const secret = handleSecrets.get(handle);
  return secret?.owner === owner ? secret : undefined;
};

export const providerUploadReference = (
  handle: JmapAttachmentHandle,
  owner: object,
): JmapProviderUploadReference | undefined => {
  const secret = handleSecrets.get(handle);
  if (!secret || secret.kind !== "upload" || secret.owner !== owner) {
    return undefined;
  }
  if (handle.size === null) return undefined;
  return Object.freeze({
    blobId: secret.blobId,
    size: handle.size,
    type: handle.mediaType,
  });
};
