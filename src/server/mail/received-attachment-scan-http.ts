import "server-only";

import {
  ReceivedAttachmentScanError,
} from "@/server/mail/received-attachment-scan";
import { ApiError } from "@/transport/http/api-error";

export const asReceivedAttachmentScanApiError = (
  error: unknown,
): unknown => {
  if (!(error instanceof ReceivedAttachmentScanError)) return error;
  const mapped = {
    aborted: ["Attachment inspection was cancelled.", "ATTACHMENT_SCAN_ABORTED", 499],
    corrupt: ["The inspected attachment could not be verified.", "ATTACHMENT_SCAN_FAILED", 502],
    expired: ["Attachment inspection expired. Please try again.", "ATTACHMENT_SCAN_EXPIRED", 410],
    infected: ["This attachment was blocked by malware scanning.", "ATTACHMENT_THREAT_DETECTED", 422],
    invalid_input: ["The attachment could not be inspected.", "ATTACHMENT_SCAN_FAILED", 502],
    length_mismatch: ["The mail provider returned incomplete attachment data.", "ATTACHMENT_PROVIDER_FAILED", 502],
    quota_exceeded: ["Attachment inspection is busy. Please try again shortly.", "ATTACHMENT_SCAN_BUSY", 429],
    scan_incomplete: ["The attachment scanner could not verify the complete file.", "ATTACHMENT_SCANNER_UNAVAILABLE", 503],
    scanner_unavailable: ["The attachment scanner is unavailable. Please try again.", "ATTACHMENT_SCANNER_UNAVAILABLE", 503],
    scope_mismatch: ["The attachment was not found.", "ATTACHMENT_NOT_FOUND", 404],
    size_limit_exceeded: ["This attachment is too large to inspect.", "ATTACHMENT_TOO_LARGE", 413],
    state_conflict: ["The inspected attachment is no longer available.", "ATTACHMENT_SCAN_CONFLICT", 409],
    storage_unavailable: ["Attachment inspection is temporarily unavailable.", "ATTACHMENT_SCANNER_UNAVAILABLE", 503],
    timeout: ["Attachment inspection took too long. Please try again.", "ATTACHMENT_SCAN_TIMEOUT", 504],
  } as const;
  const [message, code, status] = mapped[error.code];
  return new ApiError(message, code, status);
};
