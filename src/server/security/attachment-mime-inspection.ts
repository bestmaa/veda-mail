import "server-only";

import { fileTypeFromBuffer } from "file-type";

import type { AttachmentMimeDetector } from "@/server/attachments";

const STRUCTURED_TEXT_HINTS = new Set(["application/json", "application/xml"]);

const looksLikeUtf8Text = (sample: Uint8Array): boolean => {
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
};

const looksLikeSvg = (sample: Uint8Array): boolean => {
  if (!looksLikeUtf8Text(sample)) return false;
  const prefix = new TextDecoder().decode(sample).slice(0, 2_048);
  return /^(?:\s*<\?xml[^>]*>\s*)?\s*<svg(?:\s|>)/iu.test(prefix);
};

export class MagicNumberMimeDetector implements AttachmentMimeDetector {
  public async detect({
    declaredMimeType,
    sample,
  }: Parameters<AttachmentMimeDetector["detect"]>[0]) {
    const detected = await fileTypeFromBuffer(sample);
    if (detected) {
      return { mimeType: detected.mime, verdict: "accepted" as const };
    }
    if (looksLikeSvg(sample)) {
      return { mimeType: "image/svg+xml", verdict: "accepted" as const };
    }
    if (
      looksLikeUtf8Text(sample) &&
      (declaredMimeType.startsWith("text/") ||
        STRUCTURED_TEXT_HINTS.has(declaredMimeType))
    ) {
      return {
        mimeType: "text/plain",
        verdict: "accepted" as const,
      };
    }
    return {
      mimeType: "application/octet-stream",
      verdict: "accepted" as const,
    };
  }
}
