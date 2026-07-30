import "server-only";

import { MAX_RENDERABLE_RECEIVED_INLINE_IMAGES } from "@/domain/mail/inline-image";
import { normalizeCidUrlContentId } from "@/domain/mail/received-attachment";
import type { AttachmentId } from "@/domain/shared/brand";

const MAX_INLINE_IMAGE_CANDIDATES = 1_280;
const MAX_INLINE_IMAGE_ATTACHMENT_ID_LENGTH = 512;
const MAX_INLINE_IMAGE_CONTENT_ID_LENGTH = 998;
const MAX_INLINE_IMAGE_TEXT_LENGTH = 512;
export const INLINE_IMAGE_ATTRIBUTE = "data-veda-inline-image";
const RENDERED_INLINE_IMAGE_ATTRIBUTE =
  /\bdata-veda-inline-image="([A-Za-z0-9_-]{1,512})"/gu;

export interface VerifiedInlineImage {
  readonly attachmentId: AttachmentId;
  readonly contentId: string;
}

interface InlineImageLookup {
  readonly attachmentIds: ReadonlySet<string>;
  readonly byContentId: ReadonlyMap<string, string>;
}

const hasUnsafeContentIdCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f;
  });

const createInlineImageLookup = (
  images: readonly VerifiedInlineImage[],
): InlineImageLookup => {
  if (images.length > MAX_INLINE_IMAGE_CANDIDATES) {
    return {
      attachmentIds: new Set(),
      byContentId: new Map(),
    };
  }
  const candidates = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const image of images) {
    const contentId = image.contentId;
    const attachmentId = image.attachmentId.trim();
    if (
      !contentId ||
      contentId.length > MAX_INLINE_IMAGE_CONTENT_ID_LENGTH ||
      hasUnsafeContentIdCharacter(contentId) ||
      !attachmentId ||
      attachmentId.length > MAX_INLINE_IMAGE_ATTACHMENT_ID_LENGTH
    ) {
      continue;
    }
    if (candidates.has(contentId)) {
      candidates.delete(contentId);
      ambiguous.add(contentId);
      continue;
    }
    if (!ambiguous.has(contentId)) {
      candidates.set(contentId, attachmentId);
    }
  }
  return {
    attachmentIds: new Set(candidates.values()),
    byContentId: candidates,
  };
};

const boundedImageText = (value?: string): string =>
  [...(value ?? "")]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .trim()
    .slice(0, MAX_INLINE_IMAGE_TEXT_LENGTH);

const inlineAttachmentId = (
  attributes: Readonly<Record<string, string>>,
  lookup: InlineImageLookup,
): string | null => {
  const source = attributes["src"]?.trim();
  if (source?.slice(0, 4).toLowerCase() === "cid:") {
    const contentId = normalizeCidUrlContentId(source.slice(4));
    return contentId ? (lookup.byContentId.get(contentId) ?? null) : null;
  }
  const existing = attributes[INLINE_IMAGE_ATTRIBUTE]?.trim();
  return existing && lookup.attachmentIds.has(existing) ? existing : null;
};

export const createInlineImageSanitizer = (
  images: readonly VerifiedInlineImage[],
) => {
  const lookup = createInlineImageLookup(images);
  let imageCount = 0;
  return {
    isAllowed: (attributes?: Readonly<Record<string, string>>): boolean =>
      Boolean(attributes?.[INLINE_IMAGE_ATTRIBUTE]),
    transform: (
      tagName: string,
      attributes: Readonly<Record<string, string>>,
    ) => {
      const attachmentId = inlineAttachmentId(attributes, lookup);
      if (
        !attachmentId ||
        imageCount >= MAX_RENDERABLE_RECEIVED_INLINE_IMAGES
      ) {
        return { attribs: {}, tagName };
      }
      imageCount += 1;
      const title = boundedImageText(attributes["title"]);
      return {
        attribs: {
          [INLINE_IMAGE_ATTRIBUTE]: attachmentId,
          alt: boundedImageText(attributes["alt"]),
          ...(title ? { title } : {}),
        },
        tagName,
      };
    },
  };
};

export const renderedInlineImageAttachmentIds = (
  sanitizedHtml: string | null,
): ReadonlySet<string> =>
  new Set(
    [...(sanitizedHtml ?? "").matchAll(RENDERED_INLINE_IMAGE_ATTRIBUTE)]
      .map((match) => match[1])
      .filter((attachmentId): attachmentId is string =>
        Boolean(attachmentId),
      ),
  );
