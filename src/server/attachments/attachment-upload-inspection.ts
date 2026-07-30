import "server-only";

import type { StoredAttachment } from "@/server/attachments/attachment-record";
import type {
  AttachmentMimeDetector,
  AttachmentScanner,
} from "@/server/attachments/attachment-types";
import { AttachmentQuarantineError } from "@/server/attachments/attachment-types";

const MIME_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/;

export const scanAttachmentFailClosed = (
  scanner: AttachmentScanner,
): AttachmentScanner => ({
  async scan(content, scanContext) {
    try {
      return await scanner.scan(content, scanContext);
    } catch (error) {
      if (error instanceof AttachmentQuarantineError) throw error;
      throw new AttachmentQuarantineError(
        "Attachment scanner is unavailable.",
        "ATTACHMENT_SCAN_UNAVAILABLE",
        503,
      );
    }
  },
});

export const detectAttachmentMime = async (
  detector: AttachmentMimeDetector,
  record: StoredAttachment,
  sample: Uint8Array,
): Promise<string> => {
  let result;
  try {
    result = await detector.detect({
      byteLength: record.contentLength,
      declaredMimeType: record.declaredMimeType,
      fileName: record.fileName,
      sample,
    });
  } catch {
    throw new AttachmentQuarantineError(
      "Attachment type detection is unavailable.",
      "ATTACHMENT_MIME_UNAVAILABLE",
      503,
    );
  }
  if (result.verdict !== "accepted" || !MIME_PATTERN.test(result.mimeType)) {
    throw new AttachmentQuarantineError(
      "Attachment type is not allowed.",
      "ATTACHMENT_TYPE_REJECTED",
      422,
    );
  }
  return result.mimeType;
};
