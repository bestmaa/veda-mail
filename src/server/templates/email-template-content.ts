import "server-only";

import {
  type EmailTemplateCanonicalContent,
  type EmailTemplateContentInput,
  MAX_EMAIL_TEMPLATE_COMBINED_CHARACTERS,
  MAX_EMAIL_TEMPLATE_COMBINED_UTF8_BYTES,
  MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS,
  MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES,
} from "@/domain/member/email-template";
import {
  canonicalizeOutgoingMailContentValue,
  OutgoingMailContentPolicyError,
} from "@/domain/mail/outgoing-mail-canonicalizer";
import { outgoingContentUtf8Bytes } from "@/domain/mail/outgoing-content-policy";
import { emailTemplateSubjectSchema } from "@/server/templates/email-template.schema";
import { ApiError } from "@/transport/http/api-error";

const tooLarge = (): never => {
  throw new ApiError(
    "The template exceeds the safe content limit.",
    "TEMPLATE_CONTENT_TOO_LARGE",
    413,
  );
};

const asApiError = (error: unknown): never => {
  if (!(error instanceof OutgoingMailContentPolicyError)) throw error;
  if (error.failure === "oversized") return tooLarge();
  throw new ApiError(
    error.failure === "complex"
      ? "The rich template is too complex."
      : "The template contains invalid or unsupported content.",
    error.failure === "complex"
      ? "TEMPLATE_CONTENT_TOO_COMPLEX"
      : "INVALID_TEMPLATE_CONTENT",
    422,
  );
};

const withinFieldLimit = (value: string): boolean =>
  value.length <= MAX_EMAIL_TEMPLATE_CONTENT_CHARACTERS &&
  outgoingContentUtf8Bytes(value) <= MAX_EMAIL_TEMPLATE_CONTENT_UTF8_BYTES;

const assertCanonicalLimits = (
  content: Pick<EmailTemplateCanonicalContent, "body" | "htmlBody">,
): void => {
  const htmlBody = content.htmlBody ?? "";
  if (!withinFieldLimit(content.body) || !withinFieldLimit(htmlBody)) {
    tooLarge();
  }
  if (
    content.body.length + htmlBody.length >
      MAX_EMAIL_TEMPLATE_COMBINED_CHARACTERS ||
    outgoingContentUtf8Bytes(content.body) +
      outgoingContentUtf8Bytes(htmlBody) >
      MAX_EMAIL_TEMPLATE_COMBINED_UTF8_BYTES
  ) {
    tooLarge();
  }
};

export const canonicalizeEmailTemplateContent = (
  input: EmailTemplateContentInput,
): EmailTemplateCanonicalContent => {
  let content;
  try {
    content = canonicalizeOutgoingMailContentValue(
      input.mode === "plain"
        ? { body: input.body }
        : { body: "Template", htmlBody: input.htmlBody },
    );
  } catch (error) {
    return asApiError(error);
  }
  assertCanonicalLimits(content);
  return {
    ...content,
    subject: emailTemplateSubjectSchema.parse(input.subject),
  };
};
