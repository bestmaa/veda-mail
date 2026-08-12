import "server-only";

import type { AttachmentQuarantineOptions } from
  "@/server/attachments/attachment-types";

export const resolveAttachmentLifetimeOptions = (
  options: AttachmentQuarantineOptions,
) => {
  if (!options.scanner?.scan || !options.mimeDetector?.detect) {
    throw new TypeError("Attachment scanner and MIME detector are required.");
  }
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const uploadIdleTimeoutMs = options.uploadIdleTimeoutMs ?? 30 * 1000;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 5 * 60 * 1000;
  for (const [label, value] of [
    ["TTL", ttlMs],
    ["upload idle timeout", uploadIdleTimeoutMs],
    ["upload timeout", uploadTimeoutMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `Attachment ${label} must be a positive safe integer.`,
      );
    }
  }
  return { ttlMs, uploadIdleTimeoutMs, uploadTimeoutMs };
};
