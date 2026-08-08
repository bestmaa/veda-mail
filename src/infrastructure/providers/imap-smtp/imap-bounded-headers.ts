import "server-only";

import type { FetchMessageObject, FetchQueryObject } from "imapflow";

export const MAX_IMAP_HEADER_BYTES = 64 * 1024;

export const boundedHeaderSourceQuery = {
  source: { maxLength: MAX_IMAP_HEADER_BYTES + 4 },
} satisfies FetchQueryObject;

export const boundedImapHeaders = (
  message: Pick<FetchMessageObject, "headers" | "source">,
): { readonly headers?: Buffer; readonly truncated: boolean } => {
  if (message.headers) {
    return message.headers.byteLength > MAX_IMAP_HEADER_BYTES
      ? { truncated: true }
      : { headers: message.headers, truncated: false };
  }
  const source = message.source;
  if (!source) return { truncated: true };
  if (source.subarray(0, 2).equals(Buffer.from("\r\n"))) {
    return { headers: Buffer.alloc(0), truncated: false };
  }
  if (source[0] === 0x0a) {
    return { headers: Buffer.alloc(0), truncated: false };
  }
  const crlfEnd = source.indexOf("\r\n\r\n");
  const lfEnd = crlfEnd < 0 ? source.indexOf("\n\n") : -1;
  const end = crlfEnd >= 0 ? crlfEnd + 2 : lfEnd >= 0 ? lfEnd + 1 : -1;
  if (end < 0 || end > MAX_IMAP_HEADER_BYTES) return { truncated: true };
  return { headers: source.subarray(0, end), truncated: false };
};
