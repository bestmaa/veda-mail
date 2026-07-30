import "server-only";

import { isSupportedReceivedInlineImageMimeType } from "@/domain/mail/inline-image";
import type { Attachment } from "@/domain/mail/mail";
import {
  normalizeContentId,
  normalizeReceivedAttachmentMimeType,
} from "@/domain/mail/received-attachment";
import {
  ambiguousSupportedJmapContentIds,
  jmapBodyPartBindingIdentity,
  jmapBodyPartProviderPartId,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-part-identity";
import type {
  JmapBodyPart,
  JmapEmail,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface JmapAttachmentCandidate {
  readonly attachment: JmapBodyPart;
  readonly fallbackDisposition: Attachment["disposition"];
  readonly forceAttachment: boolean;
}

const mediaType = (part: JmapBodyPart): string =>
  normalizeReceivedAttachmentMimeType(part.type);

const isHtmlBodyMedia = (part: JmapBodyPart): boolean => {
  const type = mediaType(part);
  return (
    type.startsWith("image/") ||
    type.startsWith("audio/") ||
    type.startsWith("video/")
  );
};

const conflictingPartIds = (
  parts: readonly JmapBodyPart[],
): ReadonlySet<string> => {
  const identities = new Map<string, Set<string>>();
  for (const part of parts) {
    const partId = jmapBodyPartProviderPartId(part);
    if (!partId) continue;
    const values = identities.get(partId) ?? new Set<string>();
    values.add(jmapBodyPartBindingIdentity(part));
    identities.set(partId, values);
  }
  return new Set(
    [...identities]
      .filter(([, values]) => values.size > 1)
      .map(([partId]) => partId),
  );
};

export const jmapAttachmentCandidates = (
  email: Pick<JmapEmail, "attachments" | "htmlBody">,
): readonly JmapAttachmentCandidate[] => {
  const htmlBodyMedia = (email.htmlBody ?? []).filter(isHtmlBodyMedia);
  const allParts = [
    ...(email.attachments ?? []),
    ...(email.htmlBody ?? []),
  ];
  const conflictingIds = conflictingPartIds(allParts);
  const supportedHtmlIdentities = new Set(
    htmlBodyMedia
      .filter((part) =>
        isSupportedReceivedInlineImageMimeType(mediaType(part)),
      )
      .map(jmapBodyPartBindingIdentity),
  );
  const unsupportedHtmlIdentities = new Set(
    htmlBodyMedia
      .filter(
        (part) =>
          !isSupportedReceivedInlineImageMimeType(mediaType(part)),
      )
      .map(jmapBodyPartBindingIdentity),
  );
  const candidates: JmapAttachmentCandidate[] = [];
  const seenIdentities = new Set<string>();
  const append = (
    parts: readonly JmapBodyPart[],
    fromHtmlBody: boolean,
  ): void => {
    for (const attachment of parts) {
      const identity = jmapBodyPartBindingIdentity(attachment);
      if (seenIdentities.has(identity)) continue;
      seenIdentities.add(identity);
      const supported = isSupportedReceivedInlineImageMimeType(
        mediaType(attachment),
      );
      const partId = jmapBodyPartProviderPartId(attachment);
      const conflict = partId ? conflictingIds.has(partId) : false;
      candidates.push({
        attachment,
        fallbackDisposition:
          supported &&
          (fromHtmlBody || supportedHtmlIdentities.has(identity))
            ? "inline"
            : "attachment",
        forceAttachment:
          conflict ||
          (fromHtmlBody
            ? !supported
            : unsupportedHtmlIdentities.has(identity)),
      });
    }
  };
  append(email.attachments ?? [], false);
  append(htmlBodyMedia, true);
  const ambiguousContentIds = ambiguousSupportedJmapContentIds(
    candidates.map(({ attachment }) => attachment),
  );
  return candidates.map((candidate) => {
    const contentId =
      typeof candidate.attachment.cid === "string"
        ? normalizeContentId(candidate.attachment.cid)
        : null;
    return contentId && ambiguousContentIds.has(contentId)
      ? { ...candidate, forceAttachment: true }
      : candidate;
  });
};
