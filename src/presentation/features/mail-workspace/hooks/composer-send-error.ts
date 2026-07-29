import { ApiClientError } from "@/transport/client/api-client";

const invalidAttachmentCodes = new Set([
  "ATTACHMENT_EXPIRED",
  "ATTACHMENT_INTEGRITY_FAILED",
  "ATTACHMENT_NOT_FOUND",
]);

export const attachmentRecoveryMessage = (error: unknown): string | null =>
  error instanceof ApiClientError && invalidAttachmentCodes.has(error.code)
    ? "An attachment is no longer available. Remove it and attach the file again."
    : null;

export const composerSendErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Message not sent.";
