import "server-only";

import sharp from "sharp";

import {
  isSupportedReceivedInlineImageMimeType,
  type SupportedReceivedInlineImageMimeType,
} from "@/domain/mail/inline-image";
import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import { ApiError } from "@/transport/http/api-error";

export const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const INLINE_IMAGE_MAX_PIXELS = 16_000_000;
export const INLINE_IMAGE_MAX_DIMENSION = 4_096;
export const INLINE_IMAGE_MAX_RENDER_DIMENSION = 1_600;
export const INLINE_IMAGE_OUTPUT_MIME_TYPE = "image/webp";
const INLINE_IMAGE_PROCESSOR_TIMEOUT_SECONDS = 30;
const SHARP_TIMEOUT_MESSAGE =
  /(?:^|\n)timeout:\s+\d{1,3}% complete(?:\n|$)/iu;

const MIME_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Readonly<
  Record<SupportedReceivedInlineImageMimeType, string>
>;

export type InlineImageMimeType = SupportedReceivedInlineImageMimeType;

const unsupported = (): ApiError =>
  new ApiError(
    "This image cannot be rendered safely.",
    "INLINE_IMAGE_UNSUPPORTED",
    415,
  );

const tooLarge = (): ApiError =>
  new ApiError(
    "This image is too large to render safely.",
    "INLINE_IMAGE_TOO_LARGE",
    413,
  );

export const isInlineImageMimeType = (
  value: string,
): value is InlineImageMimeType =>
  isSupportedReceivedInlineImageMimeType(value);

const uint32BigEndian = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) * 0x1_00_00_00 +
    (bytes[offset + 1] ?? 0) * 0x1_00_00 +
    (bytes[offset + 2] ?? 0) * 0x1_00 +
    (bytes[offset + 3] ?? 0)) >>>
  0;

const uint32LittleEndian = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x1_00 +
    (bytes[offset + 2] ?? 0) * 0x1_00_00 +
    (bytes[offset + 3] ?? 0) * 0x1_00_00_00) >>>
  0;

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const assertPngContainer = (bytes: Uint8Array): void => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.byteLength < 45 ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    throw unsupported();
  }
  let offset = signature.length;
  let chunks = 0;
  while (offset <= bytes.byteLength - 12) {
    const length = uint32BigEndian(bytes, offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) {
      throw unsupported();
    }
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw unsupported();
    chunks += 1;
    if (chunks === 1 && (type !== "IHDR" || length !== 13)) {
      throw unsupported();
    }
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) throw unsupported();
      return;
    }
    offset = end;
  }
  throw unsupported();
};

const assertJpegContainer = (bytes: Uint8Array): void => {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    throw unsupported();
  }
};

const assertWebpContainer = (bytes: Uint8Array): void => {
  if (
    bytes.byteLength < 20 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    uint32LittleEndian(bytes, 4) + 8 !== bytes.byteLength
  ) {
    throw unsupported();
  }
};

export const assertStrictRasterContainer = (
  bytes: Uint8Array,
  mimeType: InlineImageMimeType,
): void => {
  if (mimeType === "image/png") assertPngContainer(bytes);
  else if (mimeType === "image/jpeg") assertJpegContainer(bytes);
  else assertWebpContainer(bytes);
};

const asInputBuffer = (bytes: Uint8Array): Buffer => Buffer.from(bytes);

const isSharpProcessorTimeout = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.length <= 4_096 &&
  SHARP_TIMEOUT_MESSAGE.test(error.message);

const mapSharpFailure = (error: unknown): never => {
  if (error instanceof AttachmentDownloadError) throw error;
  if (error instanceof ApiError) throw error;
  if (isSharpProcessorTimeout(error)) {
    throw new ApiError(
      "The image processor took too long to render this image.",
      "INLINE_IMAGE_PROCESSOR_TIMEOUT",
      504,
    );
  }
  throw unsupported();
};

export const normalizeInlineImageRaster = async (
  bytes: Uint8Array,
  mimeType: InlineImageMimeType,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  if (bytes.byteLength < 1 || bytes.byteLength > INLINE_IMAGE_MAX_BYTES) {
    throw tooLarge();
  }
  assertStrictRasterContainer(bytes, mimeType);
  const source = asInputBuffer(bytes);
  const image = sharp(source, {
    failOn: "warning",
    limitInputPixels: INLINE_IMAGE_MAX_PIXELS,
  }).timeout({ seconds: INLINE_IMAGE_PROCESSOR_TIMEOUT_SECONDS });
  let output: Buffer | undefined;
  try {
    if (signal.aborted) {
      throw new AttachmentDownloadError(
        "aborted",
        "Inline image normalization was aborted.",
      );
    }
    const metadata = await image.metadata();
    if (signal.aborted) {
      throw new AttachmentDownloadError(
        "aborted",
        "Inline image normalization was aborted.",
      );
    }
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      metadata.format !== MIME_FORMATS[mimeType] ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > INLINE_IMAGE_MAX_DIMENSION ||
      height > INLINE_IMAGE_MAX_DIMENSION ||
      width * height > INLINE_IMAGE_MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw unsupported();
    }
    const normalized = await image
      .rotate()
      .resize({
        fit: "inside",
        height: INLINE_IMAGE_MAX_RENDER_DIMENSION,
        width: INLINE_IMAGE_MAX_RENDER_DIMENSION,
        withoutEnlargement: true,
      })
      .webp({ quality: 86 })
      .toBuffer();
    output = normalized;
    if (signal.aborted) {
      throw new AttachmentDownloadError(
        "aborted",
        "Inline image normalization was aborted.",
      );
    }
    if (
      normalized.byteLength < 1 ||
      normalized.byteLength > INLINE_IMAGE_MAX_BYTES
    ) {
      throw tooLarge();
    }
    assertStrictRasterContainer(normalized, "image/webp");
    return normalized;
  } catch (error) {
    output?.fill(0);
    return mapSharpFailure(error);
  } finally {
    source.fill(0);
  }
};
