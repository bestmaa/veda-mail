import {
  MAX_OUTGOING_CONTENT_CHARACTERS,
  MAX_OUTGOING_CONTENT_UTF8_BYTES,
} from "@/domain/mail/mail";
import {
  combinedOutgoingContentWithinLimit,
  hasDisallowedContentControl,
  hasUnpairedContentSurrogate,
  outgoingContentUtf8Bytes,
} from "@/domain/mail/outgoing-content-policy";
import { z } from "zod";

export const outgoingContentString = (label: string) =>
  z
    .string()
    .max(
      MAX_OUTGOING_CONTENT_CHARACTERS,
      `${label} cannot exceed 256,000 characters.`,
    )
    .refine(
      (value) =>
        outgoingContentUtf8Bytes(value) <= MAX_OUTGOING_CONTENT_UTF8_BYTES,
      `${label} cannot exceed 256,000 UTF-8 bytes.`,
    )
    .refine(
      (value) => !hasUnpairedContentSurrogate(value),
      `${label} must contain valid Unicode.`,
    )
    .refine(
      (value) => !hasDisallowedContentControl(value),
      `${label} cannot contain unsafe control characters.`,
    );

export { combinedOutgoingContentWithinLimit };
