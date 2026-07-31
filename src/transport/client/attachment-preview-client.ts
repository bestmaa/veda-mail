import { MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES } from "@/domain/mail/received-attachment";

export const readAttachmentPreviewResponse = async (
  response: Response,
): Promise<string> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    response.headers.get("content-type")?.toLowerCase() !==
    "text/plain; charset=utf-8"
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The attachment preview returned an unsafe type.");
  }
  if (
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > MAX_RECEIVED_ATTACHMENT_TEXT_PREVIEW_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The attachment preview returned an invalid size.");
  }
  if (!response.body) {
    throw new Error("The attachment preview returned no content.");
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(declaredLength);
  let offset = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength > declaredLength - offset) {
        await reader.cancel().catch(() => undefined);
        throw new Error("The attachment preview exceeded its safe size.");
      }
      bytes.set(result.value, offset);
      offset += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== declaredLength) {
    throw new Error("The attachment preview was incomplete.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The attachment preview returned invalid text.");
  }
};
