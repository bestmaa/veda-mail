import "server-only";

import {
  DraftConflictError,
  DraftContentTruncatedError,
  DraftHasAttachmentsError,
  DraftInputError,
  DraftNotFoundError,
  DraftUnavailableError,
} from "@/domain/mail/draft-errors";
import type { DraftContent } from "@/domain/mail/draft";
import type { MessageId } from "@/domain/shared/brand";
import { canonicalizeDraftMailContent } from "@/server/mail/outgoing-mail-content";
import { ApiError } from "@/transport/http/api-error";
import { ZodError } from "zod";

type DraftRequestContent = Omit<DraftContent, "htmlBody" | "inReplyTo"> & {
  readonly htmlBody?: string | undefined;
  readonly inReplyTo?: MessageId | undefined;
};

export const canonicalizeDraftRequestContent = (
  input: DraftRequestContent,
): DraftContent => {
  const canonical = canonicalizeDraftMailContent(input);
  return {
    bcc: input.bcc,
    body: canonical.body,
    cc: input.cc,
    ...(canonical.htmlBody === undefined
      ? {}
      : { htmlBody: canonical.htmlBody }),
    ...(input.inReplyTo === undefined
      ? {}
      : { inReplyTo: input.inReplyTo }),
    subject: input.subject,
    to: input.to,
  };
};

export const asDraftDomainApiError = (
  error: unknown,
): ApiError | undefined => {
  if (error instanceof DraftNotFoundError) {
    return new ApiError(
      "This saved draft is no longer available.",
      "MAIL_DRAFT_NOT_FOUND",
      404,
    );
  }
  if (error instanceof DraftConflictError) {
    return new ApiError(
      "This saved draft changed. Reload it before trying again.",
      "MAIL_DRAFT_CONFLICT",
      409,
    );
  }
  if (error instanceof DraftHasAttachmentsError) {
    return new ApiError(
      "Drafts with provider attachments cannot be changed yet.",
      "MAIL_DRAFT_HAS_ATTACHMENTS",
      409,
    );
  }
  if (error instanceof DraftContentTruncatedError) {
    return new ApiError(
      "The complete saved draft could not be loaded safely, so it was not changed.",
      "MAIL_DRAFT_CONTENT_TRUNCATED",
      409,
    );
  }
  if (error instanceof DraftUnavailableError) {
    return new ApiError(
      "Provider-backed drafts are not available for this mailbox.",
      "MAIL_DRAFT_UNAVAILABLE",
      409,
    );
  }
  if (error instanceof DraftInputError) {
    return new ApiError(
      "The saved draft could not be accepted.",
      "MAIL_DRAFT_INVALID",
      422,
    );
  }
  return undefined;
};

export const asDraftApiError = (error: unknown): unknown => {
  if (error instanceof ApiError || error instanceof ZodError) return error;
  return (
    asDraftDomainApiError(error) ??
    new ApiError(
      "The mail provider could not complete this draft request.",
      "MAIL_DRAFT_PROVIDER_FAILED",
      503,
    )
  );
};
