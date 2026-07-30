import "server-only";

import { isSupportedReceivedInlineImageMimeType } from "@/domain/mail/inline-image";
import type { Attachment } from "@/domain/mail/mail";
import {
  isJmapReceivedAttachmentInlineRenderingAllowed,
  readJmapReceivedAttachmentPartIdentity,
  type JmapReceivedAttachment,
} from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-attachment";
import { jmapBodyPartBindingIdentity } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap-part-identity";
import type { JmapBodyPart } from "@/infrastructure/providers/stalwart-jmap/stalwart-jmap.types";

export interface JmapInlineImageCandidate {
  readonly attachmentId: Attachment["id"];
  readonly contentId: string;
}

export interface JmapSequentialInlineImage
  extends JmapInlineImageCandidate {
  readonly name: string;
}

export const jmapInlineImageCandidates = (
  attachments: readonly JmapReceivedAttachment[],
): readonly JmapInlineImageCandidate[] => {
  const contentIdCounts = new Map<string, number>();
  for (const attachment of attachments) {
    if (attachment.contentId) {
      contentIdCounts.set(
        attachment.contentId,
        (contentIdCounts.get(attachment.contentId) ?? 0) + 1,
      );
    }
  }
  return attachments.flatMap((attachment) => {
    const rawContentId = attachment.contentId;
    const contentId =
      rawContentId ??
      (attachment.metadata.disposition === "inline"
        ? `veda-jmap-sequential.${attachment.metadata.id}`
        : null);
    if (
      !contentId ||
      (rawContentId && contentIdCounts.get(rawContentId) !== 1) ||
      !isJmapReceivedAttachmentInlineRenderingAllowed(attachment) ||
      !isSupportedReceivedInlineImageMimeType(
        attachment.metadata.mimeType,
      )
    ) {
      return [];
    }
    return [{ attachmentId: attachment.metadata.id, contentId }];
  });
};

export const jmapSequentialInlineImages = (
  parts: readonly JmapBodyPart[] | undefined,
  attachments: readonly JmapReceivedAttachment[],
): readonly (JmapSequentialInlineImage | null)[] => {
  const candidates = new Map(
    jmapInlineImageCandidates(attachments).map((candidate) => [
      candidate.attachmentId,
      candidate,
    ]),
  );
  const bindings = new Map<string, JmapSequentialInlineImage>();
  const ambiguous = new Set<string>();
  for (const attachment of attachments) {
    const identity = readJmapReceivedAttachmentPartIdentity(attachment);
    const candidate = candidates.get(attachment.metadata.id);
    if (
      !identity ||
      !candidate ||
      attachment.metadata.disposition !== "inline"
    ) {
      continue;
    }
    if (bindings.has(identity)) {
      bindings.delete(identity);
      ambiguous.add(identity);
      continue;
    }
    if (!ambiguous.has(identity)) {
      bindings.set(identity, {
        ...candidate,
        name: attachment.metadata.name,
      });
    }
  }
  return (parts ?? []).map((part) =>
    isSupportedReceivedInlineImageMimeType(
      part.type.split(";", 1)[0]?.trim().toLowerCase() ?? "",
    )
      ? (bindings.get(jmapBodyPartBindingIdentity(part)) ?? null)
      : null,
  );
};
