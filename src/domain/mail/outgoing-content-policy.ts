import {
  MAX_OUTGOING_CONTENT_CHARACTERS,
  MAX_OUTGOING_CONTENT_COMBINED_CHARACTERS,
  MAX_OUTGOING_CONTENT_COMBINED_UTF8_BYTES,
  MAX_OUTGOING_CONTENT_UTF8_BYTES,
} from "@/domain/mail/mail";

const encoder = new TextEncoder();
const MAX_OUTGOING_LINK_CHARACTERS = 2_048;

export type CanonicalOutgoingLink =
  | { readonly href: string; readonly status: "valid" }
  | { readonly status: "invalid" | "too-large" };

export const outgoingContentUtf8Bytes = (value: string): number =>
  encoder.encode(value).byteLength;

export const hasUnpairedContentSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        next < 0xdc00 ||
        next > 0xdfff
      ) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

export const hasDisallowedContentControl = (value: string): boolean =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    );
  });

export const canonicalizeOutgoingLink = (
  value?: string,
): CanonicalOutgoingLink => {
  const candidate = value?.trim();
  if (!candidate) return { status: "invalid" };
  if (
    candidate.length > MAX_OUTGOING_LINK_CHARACTERS ||
    outgoingContentUtf8Bytes(candidate) > MAX_OUTGOING_LINK_CHARACTERS
  ) {
    return { status: "too-large" };
  }
  if (
    hasUnpairedContentSurrogate(candidate) ||
    hasDisallowedContentControl(candidate)
  ) {
    return { status: "invalid" };
  }
  try {
    const url = new URL(candidate);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
      return { status: "invalid" };
    }
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.username || url.password)
    ) {
      return { status: "invalid" };
    }
    if (url.protocol === "mailto:") {
      let address: string;
      try {
        address = decodeURIComponent(url.pathname);
      } catch {
        return { status: "invalid" };
      }
      if (
        url.search ||
        url.hash ||
        address.length > 254 ||
        hasUnpairedContentSurrogate(address) ||
        hasDisallowedContentControl(address) ||
        !/^[^\s@,;]+@[^\s@,;]+$/u.test(address)
      ) {
        return { status: "invalid" };
      }
    } else if (!url.hostname) {
      return { status: "invalid" };
    }
    const href = url.href;
    if (
      href.length > MAX_OUTGOING_LINK_CHARACTERS ||
      outgoingContentUtf8Bytes(href) > MAX_OUTGOING_LINK_CHARACTERS
    ) {
      return { status: "too-large" };
    }
    return { href, status: "valid" };
  } catch {
    return { status: "invalid" };
  }
};

export const outgoingContentWithinLimit = (value: string): boolean =>
  value.length <= MAX_OUTGOING_CONTENT_CHARACTERS &&
  outgoingContentUtf8Bytes(value) <= MAX_OUTGOING_CONTENT_UTF8_BYTES;

export const combinedOutgoingContentWithinLimit = (
  body: string,
  htmlBody = "",
): boolean =>
  body.length + htmlBody.length <=
    MAX_OUTGOING_CONTENT_COMBINED_CHARACTERS &&
  outgoingContentUtf8Bytes(body) + outgoingContentUtf8Bytes(htmlBody) <=
    MAX_OUTGOING_CONTENT_COMBINED_UTF8_BYTES;
