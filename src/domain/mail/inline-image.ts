export const SUPPORTED_RECEIVED_INLINE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedReceivedInlineImageMimeType =
  (typeof SUPPORTED_RECEIVED_INLINE_IMAGE_MIME_TYPES)[number];

const supportedMimeTypes = new Set<string>(
  SUPPORTED_RECEIVED_INLINE_IMAGE_MIME_TYPES,
);

export const isSupportedReceivedInlineImageMimeType = (
  value: string,
): value is SupportedReceivedInlineImageMimeType =>
  supportedMimeTypes.has(value);

export const MAX_RENDERABLE_RECEIVED_INLINE_IMAGES = 8;
