import "server-only";

import { isSupportedReceivedInlineImageMimeType } from "@/domain/mail/inline-image";
import {
  normalizeContentId,
  normalizeReceivedAttachmentMimeType,
} from "@/domain/mail/received-attachment";
import type { JmapBodyPart } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

const safeText = (value: unknown, maximumLength: number): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumLength &&
  ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  })
    ? value
    : null;

const normalizedSize = (value: unknown): number | null =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0
    ? value
    : null;

export const jmapBodyPartProviderPartId = (
  part: JmapBodyPart,
): string | null => safeText(part.partId, 1_024);

export const jmapBodyPartBindingIdentity = (
  part: JmapBodyPart,
): string =>
  JSON.stringify([
    jmapBodyPartProviderPartId(part),
    safeText(part.blobId, 1_024),
    typeof part.cid === "string" ? normalizeContentId(part.cid) : null,
    part.disposition?.trim().toLowerCase() ?? null,
    part.name ?? null,
    normalizedSize(part.size),
    normalizeReceivedAttachmentMimeType(part.type),
  ]);

export const ambiguousSupportedJmapContentIds = (
  parts: readonly JmapBodyPart[],
): ReadonlySet<string> => {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const contentId =
      typeof part.cid === "string" ? normalizeContentId(part.cid) : null;
    if (
      contentId &&
      isSupportedReceivedInlineImageMimeType(
        normalizeReceivedAttachmentMimeType(part.type),
      )
    ) {
      counts.set(contentId, (counts.get(contentId) ?? 0) + 1);
    }
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count > 1)
      .map(([contentId]) => contentId),
  );
};
