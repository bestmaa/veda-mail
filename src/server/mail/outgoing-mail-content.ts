import "server-only";

import {
  canonicalizeDraftMailContentValue,
  canonicalizeOutgoingMailContentValue,
  type CanonicalOutgoingMailContent,
  type OutgoingMailContentInput,
  OutgoingMailContentPolicyError,
} from "@/domain/mail/outgoing-mail-canonicalizer";
import { ApiError } from "@/transport/http/api-error";

export type { CanonicalOutgoingMailContent } from "@/domain/mail/outgoing-mail-canonicalizer";

const asApiError = (error: unknown): never => {
  if (!(error instanceof OutgoingMailContentPolicyError)) throw error;
  if (error.failure === "oversized") {
    throw new ApiError(
      "The message body exceeds the safe content limit.",
      "MESSAGE_CONTENT_TOO_LARGE",
      413,
    );
  }
  if (error.failure === "complex") {
    throw new ApiError(
      "The rich message body is too complex.",
      "MESSAGE_CONTENT_TOO_COMPLEX",
      422,
    );
  }
  throw new ApiError(
    "The message body contains invalid or unsupported content.",
    "INVALID_MESSAGE_CONTENT",
    422,
  );
};

const canonicalize = (
  input: OutgoingMailContentInput,
  draft: boolean,
): CanonicalOutgoingMailContent => {
  try {
    return draft
      ? canonicalizeDraftMailContentValue(input)
      : canonicalizeOutgoingMailContentValue(input);
  } catch (error) {
    return asApiError(error);
  }
};

export const canonicalizeOutgoingMailContent = (
  input: OutgoingMailContentInput,
): CanonicalOutgoingMailContent => canonicalize(input, false);

export const canonicalizeDraftMailContent = (
  input: OutgoingMailContentInput,
): CanonicalOutgoingMailContent => canonicalize(input, true);
