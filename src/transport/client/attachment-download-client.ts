import {
  MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
  sanitizeReceivedAttachmentName,
} from "@/domain/mail/received-attachment";

const declaredDownloadBytes = (
  response: Response,
  maxBytes: number,
): number | null => {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d{1,10}$/u.test(value)) {
    throw new Error("The attachment returned an invalid size.");
  }
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size > maxBytes
  ) {
    throw new Error("The attachment exceeds the safe download size.");
  }
  return size;
};

const readBoundedDownload = async (
  response: Response,
  maxBytes: number,
): Promise<Blob> => {
  let declared: number | null;
  try {
    declared = declaredDownloadBytes(response, maxBytes);
  } catch (error) {
    void response.body?.cancel(error).catch(() => undefined);
    throw error;
  }
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
        received > maxBytes ||
        (declared !== null && received > declared)
      ) {
        throw new Error("The attachment exceeded its declared safe size.");
      }
      const chunk = new Uint8Array(result.value.byteLength);
      chunk.set(result.value);
      chunks.push(chunk.buffer);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
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
  maxBytes = MAX_RECEIVED_ATTACHMENT_DOWNLOAD_BYTES,
): Promise<void> => {
  const blob = await readBoundedDownload(response, maxBytes);
  const url = URL.createObjectURL(blob);
  const revoke = (): void => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Browser cleanup is best-effort and must not replace the real failure.
    }
  };
  let anchor: HTMLAnchorElement | null = null;
  let handedToBrowser = false;
  try {
    anchor = document.createElement("a");
    anchor.download = sanitizeReceivedAttachmentName(fileName);
    anchor.href = url;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    handedToBrowser = true;
  } finally {
    try {
      anchor?.remove();
    } catch {
      // The download result must not be hidden by DOM cleanup failures.
    }
    if (handedToBrowser) {
      try {
        window.setTimeout(revoke, 60_000);
      } catch {
        revoke();
      }
    } else {
      revoke();
    }
  }
};
