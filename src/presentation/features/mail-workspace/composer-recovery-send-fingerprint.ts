import type { MailAddress } from "@/domain/mail/mail";
import type { ComposerRecoverySendRequest } from "@/presentation/features/mail-workspace/composer-recovery.types";
import { sendMessageSchema } from "@/transport/http/request-schemas";

const fingerprintAddresses = (addresses: readonly MailAddress[]) =>
  addresses.map(({ email, name }) => ({ email, name }));

const fingerprintPayload = (
  request: ComposerRecoverySendRequest,
): string => JSON.stringify([
  "veda-mail:composer-send:v1",
  {
    attachmentIds: request.attachmentIds.map(String),
    bcc: fingerprintAddresses(request.bcc),
    body: request.body,
    cc: fingerprintAddresses(request.cc),
    draftId: request.draftId,
    expectedDraftRevision: request.expectedDraftRevision ?? null,
    htmlBody: request.htmlBody ?? null,
    inReplyTo: request.inReplyTo ?? null,
    providerDraftId: request.providerDraftId ?? null,
    subject: request.subject,
    to: fingerprintAddresses(request.to),
  },
]);

const sha256 = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export interface FingerprintedComposerRecoverySend {
  readonly request: ComposerRecoverySendRequest;
  readonly requestFingerprint: string;
}

/**
 * Canonicalizes the exact request that will be sent and derives a one-way
 * marker for the durable terminal journal. The request itself stays in memory.
 */
export const fingerprintComposerRecoverySend = async (
  input: ComposerRecoverySendRequest,
): Promise<FingerprintedComposerRecoverySend> => {
  const request = sendMessageSchema.parse(input) as ComposerRecoverySendRequest;
  return {
    request,
    requestFingerprint: await sha256(fingerprintPayload(request)),
  };
};
