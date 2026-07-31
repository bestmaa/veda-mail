import {
  MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";

const declaredDownloadBytes = (response: Response): number | null => {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d{1,10}$/u.test(value)) {
    throw new Error("The attachment returned an invalid size.");
  }
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES
  ) {
    throw new Error("The attachment exceeds the safe download size.");
  }
  return size;
};

const readBoundedDownload = async (response: Response): Promise<Blob> => {
  const declared = declaredDownloadBytes(response);
  if (!response.body) throw new Error("The attachment returned no content.");
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (
        received > MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES ||
        (declared !== null && received > declared)
      ) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The attachment exceeded its declared safe size.");
      }
      const chunk = new Uint8Array(result.value.byteLength);
      chunk.set(result.value);
      chunks.push(chunk.buffer);
    }
  } finally {
    reader.releaseLock();
  }
  if (declared !== null && received !== declared) {
    throw new Error("The attachment download was incomplete.");
  }
  return new Blob(chunks, { type: "application/octet-stream" });
};

export const saveAttachmentResponse = async (
  response: Response,
  fileName: string,
): Promise<void> => {
  const blob = await readBoundedDownload(response);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = sanitizeReceivedAttachmentName(fileName);
  anchor.href = url;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
