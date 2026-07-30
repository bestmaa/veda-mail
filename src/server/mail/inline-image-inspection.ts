import "server-only";

import { AttachmentDownloadError } from "@/domain/mail/attachment-download-error";
import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments";
import { waitForAttachmentImport } from "@/server/mail/attachment-import-operation";
import {
  isInlineImageMimeType,
  normalizeInlineImageRaster,
  type InlineImageMimeType,
} from "@/server/mail/inline-image-raster";
import { ApiError } from "@/transport/http/api-error";

const SAMPLE_BYTES = 8_192;
const SCAN_CHUNK_BYTES = 64 * 1_024;

const unsupported = (): ApiError =>
  new ApiError(
    "This image cannot be rendered safely.",
    "INLINE_IMAGE_UNSUPPORTED",
    415,
  );

const blocked = (): ApiError =>
  new ApiError(
    "This image was blocked from inline rendering.",
    "INLINE_IMAGE_BLOCKED",
    422,
  );

const scannerUnavailable = (): ApiError =>
  new ApiError(
    "The attachment security scanner is unavailable.",
    "INLINE_IMAGE_SCANNER_UNAVAILABLE",
    503,
  );

const inspectEveryByte = async (
  bytes: Uint8Array,
  scanner: AttachmentScanner,
  signal: AbortSignal,
): Promise<void> => {
  let inspected = 0;
  const content = async function* (): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < bytes.byteLength; offset += SCAN_CHUNK_BYTES) {
      const chunk = bytes.subarray(
        offset,
        Math.min(bytes.byteLength, offset + SCAN_CHUNK_BYTES),
      );
      inspected += chunk.byteLength;
      yield chunk;
    }
  };
  let verdict: unknown;
  try {
    if (signal.aborted) throw scannerUnavailable();
    verdict = await waitForAttachmentImport(
      scanner.scan(content(), {
        abortUpload: () => undefined,
        attachmentId: `inline-image-${crypto.randomUUID()}`,
        expectedBytes: bytes.byteLength,
        signal,
      }),
      signal,
    );
  } catch {
    throw scannerUnavailable();
  }
  if (
    inspected !== bytes.byteLength ||
    !verdict ||
    typeof verdict !== "object" ||
    !("verdict" in verdict) ||
    !["clean", "infected"].includes(String(verdict.verdict))
  ) {
    throw scannerUnavailable();
  }
  if (verdict.verdict !== "clean") throw blocked();
};

const detectRasterMimeType = async (
  bytes: Uint8Array,
  declaredMimeType: string,
  fileName: string,
  detector: AttachmentMimeDetector,
  signal: AbortSignal,
): Promise<InlineImageMimeType> => {
  if (
    bytes.byteLength === 0 ||
    !isInlineImageMimeType(declaredMimeType)
  ) {
    throw unsupported();
  }
  let detected: unknown;
  try {
    if (signal.aborted) throw unsupported();
    detected = await waitForAttachmentImport(
      detector.detect({
        byteLength: bytes.byteLength,
        declaredMimeType,
        fileName,
        sample: bytes.subarray(0, SAMPLE_BYTES),
      }),
      signal,
    );
  } catch {
    throw new ApiError(
      "Attachment type detection is unavailable.",
      "INLINE_IMAGE_MIME_UNAVAILABLE",
      503,
    );
  }
  if (
    !detected ||
    typeof detected !== "object" ||
    !("verdict" in detected) ||
    !("mimeType" in detected) ||
    detected.verdict !== "accepted" ||
    detected.mimeType !== declaredMimeType
  ) {
    throw unsupported();
  }
  return declaredMimeType;
};

export type InlineImageNormalizer = (
  bytes: Uint8Array,
  mimeType: InlineImageMimeType,
  signal: AbortSignal,
) => Promise<Uint8Array>;

export const inspectInlineImage = async (
  input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType: string;
    readonly fileName: string;
    readonly signal: AbortSignal;
  },
  dependencies: {
    readonly mimeDetector: AttachmentMimeDetector;
    readonly normalizer?: InlineImageNormalizer;
    readonly scanner: AttachmentScanner;
  },
): Promise<Uint8Array> => {
  if (
    input.bytes.byteLength === 0 ||
    !isInlineImageMimeType(input.declaredMimeType)
  ) {
    throw unsupported();
  }
  await inspectEveryByte(input.bytes, dependencies.scanner, input.signal);
  const mimeType = await detectRasterMimeType(
    input.bytes,
    input.declaredMimeType,
    input.fileName,
    dependencies.mimeDetector,
    input.signal,
  );
  try {
    if (dependencies.normalizer) {
      return await waitForAttachmentImport(
        dependencies.normalizer(
          input.bytes,
          mimeType,
          input.signal,
        ),
        input.signal,
        (late) => late.fill(0),
      );
    }
    return await normalizeInlineImageRaster(
      input.bytes,
      mimeType,
      input.signal,
    );
  } catch (error) {
    if (
      error instanceof ApiError ||
      error instanceof AttachmentDownloadError
    ) {
      throw error;
    }
    throw new ApiError(
      "The image processor is unavailable.",
      "INLINE_IMAGE_PROCESSOR_UNAVAILABLE",
      503,
    );
  }
};
